/**
 * Stage 10-C: Minimal pending confirmation store for high-risk control actions.
 *
 * Design constraints:
 * - In-memory only (process-scoped Map); no external state needed at this stage.
 * - One pending slot per session; a new high-risk control request is rejected
 *   while a previous one is already waiting.
 * - Future extension points: TTL/expiry, user-scoped keys, audit log persistence.
 */

import { logVerbose } from "../globals.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingConfirmation {
  /** Composite session key (chatId or chatId:threadId). */
  sessionKey: string;
  /** Raw original message text from the user. */
  originalText: string;
  /** ActionHint from MessageRoute (e.g. "deploy", "restart", "stop"). */
  actionHint: string | null;
  /** Matched intent from MessageRoute (e.g. "bot-deploy"). */
  matchedIntent: string;
  /** Skill/bot target, if any. */
  target: string | null;
  /** Unix timestamp (ms) when this pending entry was created. Reserved for future TTL. */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Store (module-level singleton)
// ---------------------------------------------------------------------------

/** Keyed by session key; at most one pending confirmation per session. */
export const pendingConfirmations = new Map<string, PendingConfirmation>();

// ---------------------------------------------------------------------------
// Session key
// ---------------------------------------------------------------------------

/**
 * Build a stable session key from chatId + optional forum thread.
 * DM threads ("dm" scope) share the chatId key; forum topics get their own slot.
 */
export function makePendingKey(
  chatId: number,
  threadSpec?: { id?: number; scope: "dm" | "forum" | "none" } | null,
): string {
  if (threadSpec?.scope === "forum" && threadSpec.id != null) {
    return `${chatId}:${threadSpec.id}`;
  }
  return String(chatId);
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function setPendingConfirmation(pending: PendingConfirmation): void {
  pendingConfirmations.set(pending.sessionKey, pending);
  logVerbose(
    `[confirm] stored pending confirmation sessionKey=${pending.sessionKey} intent=${pending.matchedIntent} actionHint=${pending.actionHint ?? "-"}`,
  );
}

export function getPendingConfirmation(key: string): PendingConfirmation | undefined {
  return pendingConfirmations.get(key);
}

export function clearPendingConfirmation(key: string): void {
  const had = pendingConfirmations.delete(key);
  if (had) {
    logVerbose(`[confirm] cleared pending confirmation sessionKey=${key}`);
  }
}

// ---------------------------------------------------------------------------
// Confirmation word matching
// ---------------------------------------------------------------------------

const YES_WORDS = new Set(["yes", "confirm"]);
const NO_WORDS = new Set(["no", "cancel"]);

export function isConfirmYes(text: string): boolean {
  return YES_WORDS.has(text.trim().toLowerCase());
}

export function isConfirmNo(text: string): boolean {
  return NO_WORDS.has(text.trim().toLowerCase());
}
