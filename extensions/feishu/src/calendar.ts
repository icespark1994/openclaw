import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/feishu";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuCalendarSchema, type FeishuCalendarParams } from "./calendar-schema.js";
import { createFeishuToolClient } from "./tool-account.js";

// ── Required Feishu app scopes ───────────────────────────────────────────────
// calendar:calendar:readonly  — list_calendars
// calendar:calendar.event:write — create_event (C4, not yet enabled)

const DEFAULT_TIMEZONE = "Asia/Shanghai";
const CREATE_EVENT_NOT_ENABLED_MSG =
  "真实创建日程尚未启用。" +
  "请在 C4 阶段接入确认态和 Feishu Calendar write API 后使用。" +
  " (create_event is not yet enabled; it will be wired in Stage C4.)";

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

// ── create_event_draft ────────────────────────────────────────────────────────

export type CalendarEventDraft = {
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  description: string;
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
}): CalendarEventDraft {
  const tz = params.timezone?.trim() || DEFAULT_TIMEZONE;
  const draft: CalendarEventDraft = {
    title: params.title,
    start_time: params.start_time,
    end_time: params.end_time,
    timezone: tz,
    calendar_id: params.calendar_id,
    description: params.description ?? "",
    attendees: [],
    preview: formatDraftPreview({
      title: params.title,
      start_time: params.start_time,
      end_time: params.end_time,
      timezone: tz,
      calendar_id: params.calendar_id,
    }),
  };
  return draft;
}

function formatDraftPreview(params: {
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
}): string {
  return (
    `我准备创建以下日程：\n` +
    `📅 标题：${params.title}\n` +
    `🕐 开始：${params.start_time}（${params.timezone}）\n` +
    `🕑 结束：${params.end_time}（${params.timezone}）\n` +
    `📆 日历 ID：${params.calendar_id}\n` +
    `👥 参与人：仅你（本阶段不支持邀请他人）\n\n` +
    `请回复「确认」/ "confirm" / "yes" 后创建日程。`
  );
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

  const getClient = (params: { accountId?: string } | undefined, defaultAccountId?: string) =>
    createFeishuToolClient({ api, executeParams: params, defaultAccountId });

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_calendar",
        label: "Feishu Calendar",
        description:
          "Feishu Calendar operations. " +
          "Actions: list_calendars (list available calendars), " +
          "create_event_draft (build and preview an event without writing it), " +
          "create_event (write to calendar — requires explicit user confirmation first). " +
          "IMPORTANT: ALWAYS call create_event_draft and show the result to the user " +
          "before calling create_event.",
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
                const draft = buildEventDraft({
                  title: p.title!,
                  start_time: p.start_time!,
                  end_time: p.end_time!,
                  timezone: p.timezone,
                  calendar_id: validation.calendarId,
                  description: p.description,
                });
                return json({ draft, preview: draft.preview });
              }
              case "create_event": {
                // Stage C4: real write not yet wired.
                return json({ error: CREATE_EVENT_NOT_ENABLED_MSG });
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

  api.logger.info?.("feishu_calendar: Registered feishu_calendar");
}
