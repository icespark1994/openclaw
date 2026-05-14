import { Type, type Static } from "@sinclair/typebox";

const CALENDAR_ACTION_VALUES = [
  "list_calendars",
  "create_event_draft",
  "create_event",
  "sync_contacts",
  "search_contacts",
] as const;

export const FeishuCalendarSchema = Type.Object({
  action: Type.Unsafe<(typeof CALENDAR_ACTION_VALUES)[number]>({
    type: "string",
    enum: [...CALENDAR_ACTION_VALUES],
    description:
      "Action: list_calendars | create_event_draft | create_event | sync_contacts | search_contacts. " +
      "create_event_draft → show preview → wait for user confirmation → create_event. " +
      "sync_contacts populates the local Ainetrix contact registry from Feishu " +
      "(used as secondary attendee lookup after AINETRIX_CALENDAR_ATTENDEE_MAP). " +
      "search_contacts looks up a single name/email in the registry.",
  }),
  query: Type.Optional(
    Type.String({
      description:
        "Single name or email to look up. Required for `search_contacts`. " +
        "Matches are case-insensitive on `name`, `display_name`, or `email` " +
        "(no substring/prefix — exact only).",
    }),
  ),
  title: Type.Optional(
    Type.String({ description: "Event title (required for create_event_draft / create_event)" }),
  ),
  start_time: Type.Optional(
    Type.String({
      description:
        "Event start time as ISO 8601 string, e.g. 2026-05-16T13:00:00+08:00 " +
        "(required for create_event_draft / create_event). " +
        "Always resolve relative dates ('本周五', '明天') to absolute datetime before calling.",
    }),
  ),
  end_time: Type.Optional(
    Type.String({
      description:
        "Event end time as ISO 8601 string (required for create_event_draft / create_event)",
    }),
  ),
  timezone: Type.Optional(
    Type.String({
      description: "IANA timezone name (default: Asia/Shanghai)",
    }),
  ),
  calendar_id: Type.Optional(
    Type.String({
      description:
        "Target calendar ID. Defaults to AINETRIX_FEISHU_DEFAULT_CALENDAR_ID env var. " +
        "Use list_calendars to discover available calendar IDs.",
    }),
  ),
  description: Type.Optional(Type.String({ description: "Event description (optional)" })),
  draft_id: Type.Optional(
    Type.String({
      description:
        "Draft ID from create_event_draft. Required for create_event — " +
        "pass the exact draft_id returned by the previous create_event_draft call.",
    }),
  ),
  enable_vchat: Type.Optional(
    Type.Boolean({
      description:
        "Whether to add a Feishu video conference to the event (default: true). " +
        "Set to false only when the user explicitly requests a meeting without video conference.",
    }),
  ),
  original_text: Type.Optional(
    Type.String({
      description:
        "The user's verbatim request text. " +
        "**REQUIRED for create_event_draft** — the tool will REJECT the draft if this is missing. " +
        "Pass the user's original message exactly as received (Chinese or English) " +
        "so the tool can verify and auto-correct relative date expressions " +
        "such as '今天', '明天', '后天', '本周五', '下周一'. " +
        "Example: '帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟'.",
    }),
  ),
  attendees: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.Optional(
          Type.String({
            description:
              "Display name of the attendee as the user wrote it (e.g. 'Alan', 'Peter', '张三').",
          }),
        ),
        open_id: Type.Optional(
          Type.String({
            description:
              "Feishu user open_id (starts with 'ou_'). " +
              "If omitted, the tool will try to resolve `name` via AINETRIX_CALENDAR_ATTENDEE_MAP.",
          }),
        ),
      }),
      {
        description:
          "Optional list of attendees the user wants to invite. " +
          "Phase 1 supports user-type attendees only — no rooms, no chats, no external emails. " +
          "The tool also auto-extracts names from `original_text` (e.g. '邀请 Alan 和 Peter'). " +
          "Names without a mapping in AINETRIX_CALENDAR_ATTENDEE_MAP are shown to the user as " +
          "'unresolved' on the draft and will NOT be invited.",
      },
    ),
  ),
});

export type FeishuCalendarParams = Static<typeof FeishuCalendarSchema>;
