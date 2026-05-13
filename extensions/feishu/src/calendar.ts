import { randomUUID } from "node:crypto";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/feishu";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuCalendarSchema, type FeishuCalendarParams } from "./calendar-schema.js";
import { createFeishuToolClient } from "./tool-account.js";

// ── Required Feishu app scopes ───────────────────────────────────────────────
// calendar:calendar:readonly        — list_calendars
// calendar:calendar.event:write     — create_event

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DRAFT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ── list_calendars ────────────────────────────────────────────────────────────

export async function listCalendars(client: Lark.Client): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK calendar namespace
  const lark = client as any;
  if (!lark.calendar?.calendar?.list) {
    return {
      error:
        "Feishu Calendar API is unavailable on this client. " +
        "Ensure the app has been granted the 'calendar:calendar:readonly' scope.",
    };
  }
  const res = await lark.calendar.calendar.list({ params: { page_size: 50 } });
  if (res?.code !== 0) {
    return {
      error:
        `Feishu Calendar API error: code=${res?.code ?? "?"} msg=${res?.msg ?? "unknown"}. ` +
        "Check that the app has the 'calendar:calendar:readonly' permission.",
    };
  }
  const calendars: Array<{ calendar_id: string; summary?: string; role?: string }> = (
    res.data?.calendar_list ?? []
  ).map((c: { calendar_id?: string; summary?: string; role?: string }) => ({
    calendar_id: c.calendar_id ?? "",
    summary: c.summary ?? "",
    role: c.role ?? "",
  }));
  return { calendars, total: calendars.length };
}

// ── Draft store ───────────────────────────────────────────────────────────────

export type DraftEntry = {
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  description: string;
  enable_vchat: boolean;
  source_user: string | undefined;
  source_channel: string | undefined;
  created_at: number;
};

// In-memory draft store; resets on gateway restart (acceptable for Phase 1).
export const draftStore = new Map<string, DraftEntry>();

// ── CalendarEventDraft ────────────────────────────────────────────────────────

export type CalendarEventDraft = {
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  description: string;
  enable_vchat: boolean;
  attendees: never[];
  preview: string;
};

export function buildEventDraft(params: {
  title: string;
  start_time: string;
  end_time: string;
  timezone?: string;
  calendar_id: string;
  description?: string;
  enable_vchat?: boolean;
}): CalendarEventDraft {
  const tz = params.timezone?.trim() || DEFAULT_TIMEZONE;
  const enableVchat = params.enable_vchat !== false; // default true
  return {
    title: params.title,
    start_time: params.start_time,
    end_time: params.end_time,
    timezone: tz,
    calendar_id: params.calendar_id,
    description: params.description ?? "",
    enable_vchat: enableVchat,
    attendees: [],
    preview: formatDraftPreview({
      title: params.title,
      start_time: params.start_time,
      end_time: params.end_time,
      timezone: tz,
      calendar_id: params.calendar_id,
      enable_vchat: enableVchat,
    }),
  };
}

function formatDraftPreview(params: {
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  enable_vchat: boolean;
}): string {
  const vchatLine = params.enable_vchat ? "📹 视频会议：飞书会议\n" : "📹 视频会议：无\n";
  return (
    `我准备创建以下日程：\n` +
    `📅 标题：${params.title}\n` +
    `🕐 开始：${params.start_time}（${params.timezone}）\n` +
    `🕑 结束：${params.end_time}（${params.timezone}）\n` +
    `📆 日历 ID：${params.calendar_id}\n` +
    vchatLine +
    `👥 参与人：仅你（本阶段不支持邀请他人）\n\n` +
    `请回复「确认」/ "confirm" / "yes" 后创建日程。`
  );
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

/**
 * Parse AINETRIX_CALENDAR_ALLOWED_USERS into a Set.
 * Expected format: comma-separated "channel:userId" entries,
 * e.g. "feishu:ou_abc123,telegram:8139057037".
 */
export function parseAllowedUsers(envValue: string | undefined): Set<string> {
  if (!envValue?.trim()) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Returns true if the caller is in the allowlist.
 *
 * Two entry formats are supported:
 *  - "channel:senderId"  e.g. "feishu:ou_abc123"  — per-user (requesterSenderId)
 *  - "agent:agentId"     e.g. "agent:ainetrix_feishu" — per-agent (ctx.agentId);
 *    used when requesterSenderId is unavailable (senderId propagation gap in core).
 */
export function isUserAllowed(
  channel: string | undefined,
  senderId: string | undefined,
  allowedSet: Set<string>,
  agentId?: string | undefined,
): boolean {
  if (allowedSet.size === 0) return false;
  if (channel && senderId && allowedSet.has(`${channel}:${senderId}`)) return true;
  if (agentId && allowedSet.has(`agent:${agentId}`)) return true;
  return false;
}

// ── Real Feishu Calendar event create ────────────────────────────────────────

export async function createCalendarEvent(
  client: Lark.Client,
  calendarId: string,
  entry: DraftEntry,
): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Lark SDK calendar namespace
  const lark = client as any;
  if (!lark.calendar?.calendarEvent?.create) {
    return {
      error:
        "Feishu Calendar Event API unavailable. " +
        "Ensure the app has been granted the 'calendar:calendar.event:write' scope.",
    };
  }

  // Feishu API accepts Unix timestamp (seconds) as a string.
  const startTs = String(Math.floor(new Date(entry.start_time).getTime() / 1000));
  const endTs = String(Math.floor(new Date(entry.end_time).getTime() / 1000));

  const res = await lark.calendar.calendarEvent.create({
    data: {
      summary: entry.title,
      ...(entry.description ? { description: entry.description } : {}),
      start_time: { timestamp: startTs, timezone: entry.timezone },
      end_time: { timestamp: endTs, timezone: entry.timezone },
      // vc_type "vc" = Feishu native video conference; "no_meeting" = no vchat.
      vchat: { vc_type: entry.enable_vchat ? "vc" : "no_meeting" },
    },
    path: { calendar_id: calendarId },
  });

  if (res?.code !== 0) {
    let errMsg = `Feishu Calendar API error: code=${res?.code ?? "?"} msg=${res?.msg ?? "unknown"}.`;
    if (res?.code === 11502 || res?.code === 403) {
      errMsg +=
        " Ensure the app has 'calendar:calendar.event:write' permission " +
        "and the calendar grants the app owner/writer access.";
    }
    return { error: errMsg };
  }

  const event = res.data?.event;
  // Guard: a code=0 response without event_id means the event was not persisted.
  if (!event?.event_id) {
    return {
      error:
        "Feishu Calendar API returned success (code=0) but no event_id was present in the response. " +
        "The event may not have been created. Please try again.",
    };
  }

  const vchat = event.vchat as
    | { vc_type?: string; meeting_url?: string; vc_info?: { meeting_no?: string } }
    | undefined;
  const meetingUrl = vchat?.meeting_url;

  // Patch description to include meeting_url so it is visible to all calendar subscribers
  // (Feishu only shows the vchat join button to event attendees/organizer; non-attendee
  // subscribers see the description, making this the reliable way to surface the link).
  if (entry.enable_vchat && meetingUrl && lark.calendar?.calendarEvent?.patch) {
    const meetingLine = `📹 飞书视频会议 / Feishu Meeting: ${meetingUrl}`;
    const patchedDesc = entry.description ? `${entry.description}\n\n${meetingLine}` : meetingLine;
    try {
      await lark.calendar.calendarEvent.patch({
        data: { description: patchedDesc },
        path: { calendar_id: calendarId, event_id: event.event_id },
      });
    } catch {
      // Non-fatal: vchat is still set; description patch is best-effort.
    }
  }

  return {
    success: true,
    event_id: event.event_id,
    calendar_id: calendarId,
    title: event.summary ?? entry.title,
    start_time: entry.start_time,
    end_time: entry.end_time,
    timezone: event.start_time?.timezone ?? entry.timezone,
    vchat_enabled: entry.enable_vchat,
    ...(meetingUrl ? { meeting_url: meetingUrl } : {}),
    ...(vchat?.vc_info?.meeting_no ? { meeting_no: vchat.vc_info.meeting_no } : {}),
    ...(event.app_link ? { app_link: event.app_link } : {}),
  };
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateDraftParams(
  p: FeishuCalendarParams,
  defaultCalendarId: string | undefined,
): { ok: true; calendarId: string } | { ok: false; error: string } {
  if (!p.title?.trim()) {
    return { ok: false, error: "Missing required field: title" };
  }
  if (!p.start_time?.trim()) {
    return { ok: false, error: "Missing required field: start_time (ISO 8601 format)" };
  }
  if (!p.end_time?.trim()) {
    return { ok: false, error: "Missing required field: end_time (ISO 8601 format)" };
  }
  const calendarId = p.calendar_id?.trim() || defaultCalendarId?.trim() || "";
  if (!calendarId) {
    return {
      ok: false,
      error:
        "Missing calendar_id. " +
        "Provide it as a parameter or set the AINETRIX_FEISHU_DEFAULT_CALENDAR_ID environment variable. " +
        "Use list_calendars to discover available calendar IDs.",
    };
  }
  return { ok: true, calendarId };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerFeishuCalendarTools(api: OpenClawPluginApi): void {
  if (!api.config) {
    api.logger.debug?.("feishu_calendar: No config available, skipping calendar tools");
    return;
  }
  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_calendar: No Feishu accounts configured, skipping calendar tools");
    return;
  }

  const defaultCalendarId = process.env.AINETRIX_FEISHU_DEFAULT_CALENDAR_ID?.trim() || undefined;
  const allowedUsers = parseAllowedUsers(process.env.AINETRIX_CALENDAR_ALLOWED_USERS);

  const getClient = (params: { accountId?: string } | undefined, defaultAccountId?: string) =>
    createFeishuToolClient({ api, executeParams: params, defaultAccountId });

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      // Trusted requester identity — provided by the runtime, not controllable via tool args.
      const requesterSenderId = ctx.requesterSenderId;
      const messageChannel = ctx.messageChannel;
      // agentId fallback: used when requesterSenderId is unavailable (core propagation gap).
      const agentId = ctx.agentId;

      return {
        name: "feishu_calendar",
        label: "Feishu Calendar",
        description:
          "Feishu Calendar operations. " +
          "Actions: list_calendars (list available calendars), " +
          "create_event_draft (build and preview an event without writing it — returns draft_id), " +
          "create_event (write to calendar — requires draft_id from create_event_draft " +
          "and explicit user confirmation first). " +
          "IMPORTANT: ALWAYS call create_event_draft first, show the draft to the user, " +
          "wait for confirmation, then call create_event with the draft_id.",
        parameters: FeishuCalendarSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuCalendarParams & { accountId?: string };
          try {
            switch (p.action) {
              case "list_calendars": {
                const client = getClient(p, defaultAccountId);
                return json(await listCalendars(client));
              }

              case "create_event_draft": {
                const validation = validateDraftParams(p, defaultCalendarId);
                if (!validation.ok) {
                  return json({ error: validation.error });
                }
                const baseDraft = buildEventDraft({
                  title: p.title!,
                  start_time: p.start_time!,
                  end_time: p.end_time!,
                  timezone: p.timezone,
                  calendar_id: validation.calendarId,
                  description: p.description,
                  enable_vchat: p.enable_vchat,
                });

                const draftId = randomUUID();
                const entry: DraftEntry = {
                  title: baseDraft.title,
                  start_time: baseDraft.start_time,
                  end_time: baseDraft.end_time,
                  timezone: baseDraft.timezone,
                  calendar_id: baseDraft.calendar_id,
                  description: baseDraft.description,
                  enable_vchat: baseDraft.enable_vchat,
                  source_user: requesterSenderId ?? undefined,
                  source_channel: messageChannel ?? undefined,
                  created_at: Date.now(),
                };
                draftStore.set(draftId, entry);

                return json({
                  draft: { ...baseDraft, draft_id: draftId },
                  preview: baseDraft.preview,
                });
              }

              case "create_event": {
                // ── Guard 1: draft_id required ──────────────────────────────
                const draftId = p.draft_id?.trim();
                if (!draftId) {
                  return json({
                    error:
                      "draft_id is required. " +
                      "Call create_event_draft first and pass its draft_id to create_event.",
                  });
                }

                // ── Guard 2: draft must exist ───────────────────────────────
                const entry = draftStore.get(draftId);
                if (!entry) {
                  return json({
                    error:
                      "draft_id not found or already used. " +
                      "Call create_event_draft again to start a new draft.",
                  });
                }

                // ── Guard 3: draft TTL ──────────────────────────────────────
                if (Date.now() - entry.created_at > DRAFT_TTL_MS) {
                  draftStore.delete(draftId);
                  return json({
                    error: "Draft expired (older than 30 minutes). Call create_event_draft again.",
                  });
                }

                // ── Guard 4: user/channel must match ────────────────────────
                if (entry.source_user !== undefined && entry.source_user !== requesterSenderId) {
                  return json({
                    error:
                      "draft_id does not match the current user. " +
                      "Cannot confirm a draft created by a different user.",
                  });
                }
                if (entry.source_channel !== undefined && entry.source_channel !== messageChannel) {
                  return json({
                    error:
                      "draft_id does not match the current channel. " +
                      "Cannot confirm a draft created from a different channel.",
                  });
                }

                // ── Guard 5: allowlist check ────────────────────────────────
                if (allowedUsers.size === 0) {
                  return json({
                    error:
                      "Calendar write is not enabled. " +
                      "AINETRIX_CALENDAR_ALLOWED_USERS is not configured.",
                  });
                }
                if (!isUserAllowed(messageChannel, requesterSenderId, allowedUsers, agentId)) {
                  return json({
                    error:
                      "You are not authorized to create calendar events. " +
                      "Contact the administrator to add your ID to AINETRIX_CALENDAR_ALLOWED_USERS. " +
                      `Your ID format should be: ${messageChannel ?? "<channel>"}:${requesterSenderId ?? "<your_id>"} or agent:${agentId ?? "<agentId>"}`,
                  });
                }

                // ── Real API call ───────────────────────────────────────────
                const client = getClient(p, defaultAccountId);
                const result = await createCalendarEvent(client, entry.calendar_id, entry);

                // Delete draft on success to prevent duplicate creation.
                if ((result as { success?: boolean }).success) {
                  draftStore.delete(draftId);
                }

                return json(result);
              }

              default:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exhaustive check fallback
                return json({ error: `Unknown action: ${(p as any).action}` });
            }
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      };
    },
    { name: "feishu_calendar" },
  );

  api.logger.info?.(
    "feishu_calendar: Registered feishu_calendar (Stage C4.1 — vchat enabled by default)",
  );
}
