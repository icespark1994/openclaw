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
**NEVER claim "已创建" or "已记录" unless `create_event` returns `success: true`.**

The required flow is:

1. Call `feishu_calendar` with `action: "create_event_draft"` and all event parameters.
2. Show the returned `preview` text to the user verbatim.
3. Wait for the user to reply with 确认 / confirm / yes (or equivalent clear affirmation).
4. Call `feishu_calendar` with `action: "create_event"`, passing the **exact `draft_id`** from step 1.
5. Report the result to the user. Only say "创建成功" if the tool returns `success: true`.

If the user does not confirm, do not create. If the user edits the details, call `create_event_draft` again with the updated parameters and repeat the confirmation step.

## Video Conference (vchat)

**Default behavior: every event is created with a Feishu native video conference (`enable_vchat: true`).**

- The draft preview always shows the vchat status: `📹 视频会议：飞书会议` or `📹 视频会议：无`.
- Only set `enable_vchat: false` when the user **explicitly** says "线下会议", "不要视频会议", "no video", or similar.
- After a successful `create_event`, report `meeting_url` (if returned) so the user can join directly.
- **NEVER claim** a meeting link was created unless `create_event` returns `success: true`.

## Date and Time Handling

- **Always resolve relative dates** ("本周五", "明天", "下午两点") to absolute ISO 8601 datetime before calling any tool.
- **Timezone basis: always use `Asia/Shanghai`** — do NOT use UTC or server local time. The server/container may run in UTC; ignore that. Chinese relative expressions ("今天", "明天", "后天", "本周五", "下周一") must be resolved using the Asia/Shanghai current date.
- Show the resolved absolute datetime in the draft preview so the user can verify.

### Verifying date resolution with `current_date_in_timezone`

Every `create_event_draft` response includes `current_date_in_timezone` (e.g. `"2026-05-14"`) — the actual current date in Asia/Shanghai at the time the tool ran.  
The draft preview also displays: `🗓️ 日期解析基准：Asia/Shanghai，今天是 YYYY-MM-DD`

**After calling `create_event_draft`, always check:**

| User said            | Draft start date | `current_date_in_timezone` | Action                                |
| -------------------- | ---------------- | -------------------------- | ------------------------------------- |
| "明天"               | `2026-05-14`     | `2026-05-14`               | ❌ Wrong — re-draft with `2026-05-15` |
| "明天"               | `2026-05-15`     | `2026-05-14`               | ✅ Correct                            |
| "今天"               | `2026-05-14`     | `2026-05-14`               | ✅ Correct                            |
| "后天"               | `2026-05-16`     | `2026-05-14`               | ✅ Correct                            |
| "本周五" on Thursday | `2026-05-15`     | `2026-05-14`               | ✅ Correct                            |

If the start date equals `current_date_in_timezone` but the user said "明天" or "后天", **do not confirm with the user** — silently re-call `create_event_draft` with the corrected date and show the new preview.

**Example:** Today (Asia/Shanghai) = `2026-05-14`. User says "明天下午4点".
→ Correct `start_time`: `2026-05-15T16:00:00+08:00`

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
  "title": "产品讨论",
  "start_time": "2026-05-16T15:00:00+08:00",
  "end_time": "2026-05-16T16:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "calendar_id": "optional — omit to use default",
  "description": "optional",
  "enable_vchat": true
}
```

Returns a `preview` string and a `draft_id`. Show the preview to the user as-is before asking for confirmation. **Save the `draft_id`** — you must pass it to `create_event`.

The preview will include:

- 标题、时间、时区、日历 ID
- `📹 视频会议：飞书会议`（enable_vchat=true）或 `📹 视频会议：无`（enable_vchat=false）

### create_event

**Only call after user confirms the draft. Must include `draft_id` from the previous `create_event_draft` call.**

```json
{
  "action": "create_event",
  "draft_id": "<draft_id from create_event_draft>"
}
```

The draft is valid for 30 minutes. If it expires or was already used, call `create_event_draft` again.

If the tool returns an error mentioning "not authorized" or "AINETRIX_CALENDAR_ALLOWED_USERS", tell the user they do not have write permission and to contact the administrator.

## Example Conversation

**User:** 帮我创建一个日程，明天下午3点，产品讨论，1小时

**Bot (internal):** Today (Asia/Shanghai) = `2026-05-14`, so "明天" = `2026-05-15`. Call `create_event_draft`:

```json
{
  "action": "create_event_draft",
  "title": "产品讨论",
  "start_time": "2026-05-15T15:00:00+08:00",
  "end_time": "2026-05-15T16:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "enable_vchat": true
}
```

**Bot (to user):** Show the `preview` field from the tool response verbatim.

**User:** 确认

**Bot (internal):** Call `create_event` with the `draft_id` from the previous response:

```json
{
  "action": "create_event",
  "draft_id": "<draft_id returned by create_event_draft>"
}
```

**Bot (to user):** If `success: true`, report:

- 创建成功 ✅
- event_id（可用于追踪）
- **meeting_url**（如有）作为视频会议链接，供用户直接加入
- **app_link**（如有）作为飞书日历深链，供用户在客户端查看日程
- 提示：日程已创建在 **Ainetrix Team Calendar**，团队成员可见。

If the tool returns an error, report the error message to the user.

## Disable Video Conference

If the user says "线下会议", "不要视频会议", "no video conference", or similar:

```json
{
  "action": "create_event_draft",
  "title": "...",
  "start_time": "...",
  "end_time": "...",
  "enable_vchat": false
}
```

The preview will show `📹 视频会议：无`.

## Attendees

Phase 1 does not support inviting attendees. If the user asks to invite others, explain this is not yet available and create the event for the user only.

## Configuration

The default calendar is set via `AINETRIX_FEISHU_DEFAULT_CALENDAR_ID`. If this variable is absent, the skill will be inactive. Use `list_calendars` to find the correct calendar ID if needed.

Write access is restricted by `AINETRIX_CALENDAR_ALLOWED_USERS`. If not configured, `create_event` will be rejected.

## Required Feishu App Permissions

| Scope                           | Required for                         |
| ------------------------------- | ------------------------------------ |
| `calendar:calendar:readonly`    | `list_calendars`                     |
| `calendar:calendar.event:write` | `create_event` (Stage C4.1 — active) |
