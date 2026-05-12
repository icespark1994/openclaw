---
name: feishu-calendar
description: |
  Feishu Calendar operations: list calendars, draft events, and create events after explicit user confirmation.
  Use when the user asks to create a meeting, schedule an event, set a reminder, or check available calendars.
  NOT for: reading existing events (not yet supported), cancelling events, or any calendar write without user confirmation.
metadata:
  openclaw:
    emoji: "📅"
    requires:
      env:
        - AINETRIX_FEISHU_DEFAULT_CALENDAR_ID
---

# Feishu Calendar Skill

## Confirmation Requirement (MANDATORY)

**NEVER call `create_event` without explicit user confirmation.**

The required flow is:

1. Call `feishu_calendar` with `action: "create_event_draft"` and all event parameters.
2. Show the returned `preview` text to the user verbatim.
3. Wait for the user to reply with 确认 / confirm / yes (or equivalent clear affirmation).
4. Only then call `feishu_calendar` with `action: "create_event"`.

If the user does not confirm, do not create. If the user edits the details, call `create_event_draft` again with the updated parameters and repeat the confirmation step.

## Date and Time Handling

- **Always resolve relative dates** ("本周五", "明天", "下午两点") to absolute ISO 8601 datetime before calling any tool.
- Use the user's local timezone or default to `Asia/Shanghai`.
- Show the resolved absolute datetime in the draft so the user can verify.
- Example: "本周五下午一点" → `2026-05-15T13:00:00+08:00`

## Tool Actions

### list_calendars

```json
{ "action": "list_calendars" }
```

Returns available calendars with their `calendar_id`. Use this when the user asks which calendars exist or when `AINETRIX_FEISHU_DEFAULT_CALENDAR_ID` might not be the right target.

### create_event_draft

```json
{
  "action": "create_event_draft",
  "title": "税务报表解析",
  "start_time": "2026-05-15T13:00:00+08:00",
  "end_time": "2026-05-15T14:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "calendar_id": "optional — omit to use default",
  "description": "optional"
}
```

Returns a `preview` string. Show it to the user as-is before asking for confirmation.

### create_event

**Only call after user confirms the draft.**

```json
{
  "action": "create_event",
  "title": "...",
  "start_time": "...",
  "end_time": "...",
  "timezone": "Asia/Shanghai",
  "calendar_id": "..."
}
```

> Note: In the current stage (C3), `create_event` returns a stub response. Real write will be enabled in Stage C4.

## Example Conversation

**User:** 帮我创建一个日程，本周五下午一点，会议主题：税务报表解析，会议时长：1小时。

**Bot (internal):** Call `create_event_draft`:

```json
{
  "action": "create_event_draft",
  "title": "税务报表解析",
  "start_time": "2026-05-16T13:00:00+08:00",
  "end_time": "2026-05-16T14:00:00+08:00",
  "timezone": "Asia/Shanghai"
}
```

**Bot (to user):** Show the `preview` field from the tool response.

**User:** 确认

**Bot (internal):** Call `create_event` with the same parameters. Report the result.

## Attendees

Phase 1 does not support inviting attendees. If the user asks to invite others, explain this is not yet available and create the event for the user only.

## Configuration

The default calendar is set via `AINETRIX_FEISHU_DEFAULT_CALENDAR_ID`. If this variable is absent, the skill will be inactive. Use `list_calendars` to find the correct calendar ID if needed.

## Required Feishu App Permissions

| Scope                           | Required for              |
| ------------------------------- | ------------------------- |
| `calendar:calendar:readonly`    | `list_calendars`          |
| `calendar:calendar.event:write` | `create_event` (Stage C4) |
