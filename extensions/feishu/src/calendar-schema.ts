import { Type, type Static } from "@sinclair/typebox";

const CALENDAR_ACTION_VALUES = ["list_calendars", "create_event_draft", "create_event"] as const;

export const FeishuCalendarSchema = Type.Object({
  action: Type.Unsafe<(typeof CALENDAR_ACTION_VALUES)[number]>({
    type: "string",
    enum: [...CALENDAR_ACTION_VALUES],
    description:
      "Action: list_calendars | create_event_draft | create_event. " +
      "Always call create_event_draft first, show the draft to the user, " +
      "and only call create_event after explicit user confirmation.",
  }),
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
        "REQUIRED when the user uses relative date expressions such as '今天', '明天', '后天', '本周五', '下周一'. " +
        "The tool parses this text to verify and auto-correct the date resolved in start_time. " +
        "Example: '帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟'.",
    }),
  ),
});

export type FeishuCalendarParams = Static<typeof FeishuCalendarSchema>;
