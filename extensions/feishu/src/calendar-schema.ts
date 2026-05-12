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
});

export type FeishuCalendarParams = Static<typeof FeishuCalendarSchema>;
