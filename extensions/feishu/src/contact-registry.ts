import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Calendar Skill C6 — Ainetrix contacts registry.
 *
 * Built from Feishu Contact API. Used by the calendar attendee resolver as a
 * secondary lookup source after AINETRIX_CALENDAR_ATTENDEE_MAP. Keeps only the
 * minimum fields needed to invite a user (name + email + open_id), no phone /
 * department / employee numbers — mobile is intentionally dropped during sync.
 */

export type ContactStatus = "active" | "frozen" | "resigned" | "unknown";

export type ContactUser = {
  name: string;
  display_name?: string;
  email?: string;
  open_id: string;
  user_id?: string;
  status: ContactStatus;
};

export type ContactRegistry = {
  synced_at: string;
  users: ContactUser[];
};

export type ContactRegistryResolution =
  | { kind: "unique"; user: ContactUser; matched_by: "name" | "display_name" | "email" }
  | { kind: "multiple"; candidates: ContactUser[]; matched_by: "name" | "display_name" }
  | { kind: "none" };

/** Default location inside the gateway container. */
export const DEFAULT_REGISTRY_PATH = "/home/node/.openclaw/data/ainetrix_contacts.json";

export function getRegistryPath(): string {
  return process.env.AINETRIX_CONTACT_REGISTRY_PATH?.trim() || DEFAULT_REGISTRY_PATH;
}

export function getRegistryTtlDays(): number {
  const raw = process.env.AINETRIX_CONTACT_REGISTRY_TTL_DAYS?.trim();
  if (!raw) return 7;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

export async function loadRegistry(filePath?: string): Promise<ContactRegistry | null> {
  const target = filePath ?? getRegistryPath();
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(text) as ContactRegistry;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.users)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRegistry(reg: ContactRegistry, filePath?: string): Promise<void> {
  const target = filePath ?? getRegistryPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write atomically to avoid partial reads if the process dies mid-write.
  const tmp = `${target}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(reg, null, 2), "utf8");
  await fs.rename(tmp, target);
}

/** ISO age in days. NaN-safe — invalid timestamps are treated as "very old". */
export function registryAgeDays(reg: ContactRegistry, now: Date = new Date()): number {
  const t = Date.parse(reg.synced_at);
  if (Number.isNaN(t)) return Infinity;
  return (now.getTime() - t) / 86_400_000;
}

export function isRegistryStale(
  reg: ContactRegistry,
  ttlDays: number = getRegistryTtlDays(),
): boolean {
  return registryAgeDays(reg) > ttlDays;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Resolve a single name/email query against the registry.
 *
 * Matching rules (case-insensitive):
 *  1. If the query looks like an email → exact match on `email`. Resigned/frozen
 *     accounts are filtered out.
 *  2. Otherwise, match `name` (Feishu's primary name field) first; if no hit,
 *     try `display_name`. Only **exact** match — substring/prefix is rejected
 *     to avoid inviting the wrong person.
 *  3. Active users are preferred. If multiple active users share the same name,
 *     return `multiple` so the caller can refuse to invite.
 */
export function resolveContact(reg: ContactRegistry, query: string): ContactRegistryResolution {
  const q = query.trim();
  if (!q) return { kind: "none" };

  const isActive = (u: ContactUser): boolean => u.status === "active" || u.status === "unknown";

  if (EMAIL_RE.test(q)) {
    const lower = q.toLowerCase();
    const matches = reg.users.filter(
      (u) => u.email && u.email.toLowerCase() === lower && isActive(u),
    );
    if (matches.length === 1) {
      return { kind: "unique", user: matches[0]!, matched_by: "email" };
    }
    return matches.length === 0
      ? { kind: "none" }
      : // Two active users with the same email shouldn't happen, but be safe.
        { kind: "multiple", candidates: matches, matched_by: "display_name" };
  }

  const qLower = q.toLowerCase();
  const nameMatches = reg.users.filter(
    (u) => u.name && u.name.toLowerCase() === qLower && isActive(u),
  );
  if (nameMatches.length === 1) {
    return { kind: "unique", user: nameMatches[0]!, matched_by: "name" };
  }
  if (nameMatches.length > 1) {
    return { kind: "multiple", candidates: nameMatches, matched_by: "name" };
  }

  const displayMatches = reg.users.filter(
    (u) => u.display_name && u.display_name.toLowerCase() === qLower && isActive(u),
  );
  if (displayMatches.length === 1) {
    return { kind: "unique", user: displayMatches[0]!, matched_by: "display_name" };
  }
  if (displayMatches.length > 1) {
    return { kind: "multiple", candidates: displayMatches, matched_by: "display_name" };
  }

  return { kind: "none" };
}

// ── Feishu Contact API sync (C6) ──────────────────────────────────────────────

export type SyncContactsResult = {
  ok: boolean;
  synced_users: number;
  registry_path: string;
  synced_at: string;
  /** Reasons (no secrets, no full open_ids). */
  warnings?: string[];
  error?: string;
};

/**
 * Sync the Ainetrix Feishu contacts into the local registry file.
 *
 * Strategy:
 *  1. Page through `contact.scope.list` to collect all open_ids in scope.
 *  2. Batch through `contact.user.batch` (≤ 50 IDs per call) for full info.
 *  3. Persist as ContactUser[] keeping only display name + email + open_id.
 *
 * Required Feishu app scopes:
 *  - `contact:contact:readonly` (scope.list)
 *  - `contact:user.base:readonly` (user.batch — name, email)
 */
export async function syncContactsFromFeishu(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK
  client: any,
  options: { filePath?: string; now?: Date } = {},
): Promise<SyncContactsResult> {
  const filePath = options.filePath ?? getRegistryPath();
  const now = options.now ?? new Date();

  if (!client?.contact?.scope?.list || !client?.contact?.user?.batch) {
    return {
      ok: false,
      synced_users: 0,
      registry_path: filePath,
      synced_at: now.toISOString(),
      error:
        "Feishu Contact API is not available on this client. " +
        "Ensure the app has 'contact:contact:readonly' and 'contact:user.base:readonly'.",
    };
  }

  const warnings: string[] = [];
  const openIds: string[] = [];

  // 1) Page through scope.list
  let pageToken: string | undefined;
  for (let safety = 0; safety < 50; safety++) {
    const res = await client.contact.scope.list({
      params: {
        user_id_type: "open_id",
        page_size: 100,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    if (res?.code !== 0) {
      return {
        ok: false,
        synced_users: 0,
        registry_path: filePath,
        synced_at: now.toISOString(),
        error:
          `Feishu contact.scope.list error: code=${res?.code ?? "?"} msg=${res?.msg ?? "unknown"}. ` +
          "Ensure the app has 'contact:contact:readonly'.",
      };
    }
    for (const id of res.data?.user_ids ?? []) openIds.push(id);
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
    if (!pageToken) break;
  }

  if (openIds.length === 0) {
    return {
      ok: true,
      synced_users: 0,
      registry_path: filePath,
      synced_at: now.toISOString(),
      warnings: [
        "No users in the app's contact scope. Check the app's permission scope in Feishu admin.",
      ],
    };
  }

  // 2) Batch through user.batch (≤ 50 per call)
  const users: ContactUser[] = [];
  const CHUNK = 50;
  for (let i = 0; i < openIds.length; i += CHUNK) {
    const chunk = openIds.slice(i, i + CHUNK);
    const res = await client.contact.user.batch({
      params: { user_ids: chunk, user_id_type: "open_id" },
    });
    if (res?.code !== 0) {
      warnings.push(
        `contact.user.batch returned code=${res?.code ?? "?"} for chunk ${i / CHUNK + 1}. ` +
          "Some users may be missing.",
      );
      continue;
    }
    for (const item of res.data?.items ?? []) {
      const openId = item.open_id ?? "";
      if (!openId) continue;
      const status: ContactStatus = item.status?.is_frozen
        ? "frozen"
        : item.status?.is_resigned || item.status?.is_exited
          ? "resigned"
          : "active";
      const user: ContactUser = {
        name: item.name ?? "(unknown)",
        ...(item.en_name && item.en_name !== item.name ? { display_name: item.en_name } : {}),
        ...(item.email ? { email: item.email } : {}),
        open_id: openId,
        ...(item.user_id ? { user_id: item.user_id } : {}),
        status,
      };
      users.push(user);
    }
  }

  const reg: ContactRegistry = {
    synced_at: now.toISOString(),
    users,
  };

  await saveRegistry(reg, filePath);

  return {
    ok: true,
    synced_users: users.length,
    registry_path: filePath,
    synced_at: reg.synced_at,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
