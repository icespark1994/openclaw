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

/**
 * Return current date in the given IANA timezone as YYYY-MM-DD.
 * Uses Intl.DateTimeFormat so it is TZ-env-independent even in UTC containers.
 */
export function getCurrentDateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "??";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── Relative date parsing (C4.3) ─────────────────────────────────────────────

/** JS day index: 0=Sun 1=Mon … 6=Sat */
const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

/** Add `days` to a YYYY-MM-DD string using UTC arithmetic to stay timezone-safe. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Days from `fromDate` to `toDate` (positive = future). Both YYYY-MM-DD. */
function dateDiffInDays(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000);
}

/** Replace date portion of an ISO 8601 string by shifting by `days`. */
function shiftDateInISO(isoString: string, days: number): string {
  const match = isoString.match(/^(\d{4}-\d{2}-\d{2})(T.+)$/);
  if (!match) return isoString;
  return addDays(match[1]!, days) + match[2]!;
}

/**
 * Resolve targetWeekday (0=Sun … 6=Sat) within the ISO week (Mon–Sun)
 * that is either the current week ("this-week") or the next ("next-week").
 * `todayStr` is YYYY-MM-DD (Asia/Shanghai).
 */
function getWeekdayDate(
  todayStr: string,
  targetWeekday: number,
  mode: "this-week" | "next-week",
): string {
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayMs = Date.UTC(y!, m! - 1, d!);
  const todayDow = new Date(todayMs).getUTCDay(); // 0=Sun … 6=Sat

  // Days since Monday of the current week (Sun wraps to -6 → treated as 6th day)
  const sinceMonday = todayDow === 0 ? 6 : todayDow - 1;
  const thisMondayMs = todayMs - sinceMonday * 86_400_000;
  const baseMondayMs = mode === "this-week" ? thisMondayMs : thisMondayMs + 7 * 86_400_000;

  // Target offset from Monday: Mon=0 … Sat=5, Sun=6
  const daysFromMonday = targetWeekday === 0 ? 6 : targetWeekday - 1;
  const targetMs = baseMondayMs + daysFromMonday * 86_400_000;
  const targetDate = new Date(targetMs);
  return `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, "0")}-${String(targetDate.getUTCDate()).padStart(2, "0")}`;
}

export type RelativeDateMatch = { phrase: string; resolvedDate: string };

/**
 * Scan `text` for the first recognised Chinese relative-date expression and
 * resolve it to YYYY-MM-DD in `timezone`.  Returns null if none found.
 *
 * Supported: 今天 明天 后天 本周一…日/天 下周一…日/天
 */
export function detectRelativeDate(text: string, timezone: string): RelativeDateMatch | null {
  const today = getCurrentDateInTimezone(timezone);

  if (text.includes("今天")) return { phrase: "今天", resolvedDate: today };
  if (text.includes("明天")) return { phrase: "明天", resolvedDate: addDays(today, 1) };
  if (text.includes("后天")) return { phrase: "后天", resolvedDate: addDays(today, 2) };

  const nextWeekM = text.match(/下周([一二三四五六日天])/);
  if (nextWeekM) {
    const wd = WEEKDAY_MAP[nextWeekM[1]!];
    if (wd !== undefined)
      return {
        phrase: `下周${nextWeekM[1]!}`,
        resolvedDate: getWeekdayDate(today, wd, "next-week"),
      };
  }

  const thisWeekM = text.match(/本周([一二三四五六日天])/);
  if (thisWeekM) {
    const wd = WEEKDAY_MAP[thisWeekM[1]!];
    if (wd !== undefined)
      return {
        phrase: `本周${thisWeekM[1]!}`,
        resolvedDate: getWeekdayDate(today, wd, "this-week"),
      };
  }

  return null;
}

export type DateCorrectionInfo = {
  detected_phrase: string;
  expected_date: string;
  original_date: string;
  corrected: boolean;
};

/**
 * If `original_text` contains a Chinese relative-date expression and the date
 * in `start_time` doesn't match, shift both `start_time` and `end_time` by
 * the same number of days (preserving duration and time-of-day).
 */
export function applyRelativeDateCorrection(params: {
  start_time: string;
  end_time: string;
  original_text: string;
  timezone: string;
}): { start_time: string; end_time: string; correction: DateCorrectionInfo | null } {
  const { start_time, end_time, original_text, timezone } = params;

  const match = detectRelativeDate(original_text, timezone);
  if (!match) return { start_time, end_time, correction: null };

  const { phrase, resolvedDate } = match;
  const startDateM = start_time.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!startDateM) return { start_time, end_time, correction: null };

  const originalDate = startDateM[1]!;
  if (originalDate === resolvedDate) {
    return {
      start_time,
      end_time,
      correction: {
        detected_phrase: phrase,
        expected_date: resolvedDate,
        original_date: originalDate,
        corrected: false,
      },
    };
  }

  const dayDiff = dateDiffInDays(originalDate, resolvedDate);
  return {
    start_time: shiftDateInISO(start_time, dayDiff),
    end_time: shiftDateInISO(end_time, dayDiff),
    correction: {
      detected_phrase: phrase,
      expected_date: resolvedDate,
      original_date: originalDate,
      corrected: true,
    },
  };
}

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
  relative_date_correction?: DateCorrectionInfo;
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
  /** Current date in the event timezone (Asia/Shanghai). */
  current_date_in_timezone: string;
  /** Set when original_text was provided and a relative-date phrase was detected. */
  relative_date_correction?: DateCorrectionInfo;
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
  /** User's verbatim request — used for code-level relative-date correction (C4.3). */
  original_text?: string;
}): CalendarEventDraft {
  const tz = params.timezone?.trim() || DEFAULT_TIMEZONE;
  const enableVchat = params.enable_vchat !== false; // default true
  const currentDate = getCurrentDateInTimezone(tz);
  const hasOriginalText = Boolean(params.original_text?.trim());

  let startTime = params.start_time;
  let endTime = params.end_time;
  let correction: DateCorrectionInfo | undefined;

  if (hasOriginalText) {
    const result = applyRelativeDateCorrection({
      start_time: params.start_time,
      end_time: params.end_time,
      original_text: params.original_text!,
      timezone: tz,
    });
    startTime = result.start_time;
    endTime = result.end_time;
    correction = result.correction ?? undefined;
  }

  return {
    title: params.title,
    start_time: startTime,
    end_time: endTime,
    timezone: tz,
    calendar_id: params.calendar_id,
    description: params.description ?? "",
    enable_vchat: enableVchat,
    attendees: [],
    current_date_in_timezone: currentDate,
    ...(correction ? { relative_date_correction: correction } : {}),
    preview: formatDraftPreview({
      title: params.title,
      start_time: startTime,
      end_time: endTime,
      timezone: tz,
      calendar_id: params.calendar_id,
      enable_vchat: enableVchat,
      current_date: currentDate,
      correction,
      hasOriginalText,
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
  current_date: string;
  correction?: DateCorrectionInfo;
  hasOriginalText: boolean;
}): string {
  const vchatLine = params.enable_vchat ? "📹 视频会议：飞书会议\n" : "📹 视频会议：无\n";

  let correctionLine = "";
  if (params.correction?.corrected) {
    correctionLine =
      `⚠️ 已根据原始文本将日期从 ${params.correction.original_date} ` +
      `修正为 ${params.correction.expected_date}（识别到"${params.correction.detected_phrase}"）\n`;
  } else if (!params.hasOriginalText) {
    correctionLine = `ℹ️ 未提供原始文本（original_text），无法进行相对日期代码级校验\n`;
  }

  return (
    `我准备创建以下日程：\n` +
    `📅 标题：${params.title}\n` +
    `🕐 开始：${params.start_time}（${params.timezone}）\n` +
    `🕑 结束：${params.end_time}（${params.timezone}）\n` +
    `📆 日历 ID：${params.calendar_id}\n` +
    vchatLine +
    `👥 参与人：仅你（本阶段不支持邀请他人）\n` +
    `🗓️ 日期解析基准：${params.timezone}，今天是 ${params.current_date}\n` +
    correctionLine +
    `\n请回复「确认」/ "confirm" / "yes" 后创建日程。`
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
  if (!p.original_text?.trim()) {
    return {
      ok: false,
      error:
        "Missing required field: original_text. " +
        "You MUST pass the user's verbatim request text (e.g. '帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟') " +
        "as original_text so the tool can verify and auto-correct relative date expressions " +
        "('今天', '明天', '后天', '本周五', '下周一', etc.). " +
        "Retry create_event_draft with original_text set to the user's original message.",
    };
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
                  original_text: p.original_text,
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
    "feishu_calendar: Registered feishu_calendar (Stage C4.4 — original_text required + tool-layer relative-date correction)",
  );
}
