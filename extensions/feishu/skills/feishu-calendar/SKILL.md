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

## `original_text` is REQUIRED (MANDATORY)

**EVERY call to `create_event_draft` MUST include `original_text`** — the user's verbatim message, exactly as received. The tool will **REJECT** the draft and return an error if `original_text` is missing.

- Always copy the user's full message (Chinese or English) into `original_text`.
- This is required even when the message contains an absolute date — pass it anyway.
- If the tool returns an error about missing `original_text`, retry once with the user's verbatim text. Do not fabricate text — use what the user actually wrote.

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

### Tool-layer offline-meeting auto-disable (C4.5)

The tool scans `original_text` for offline-meeting keywords and **forces `enable_vchat=false`** when any of these appear, even if you passed `enable_vchat: true` or omitted it:

- Chinese: `线下会议`, `线下`, `办公室`, `现场`, `当面`, `面谈`, `面对面`
- English: `offline`, `offline meeting`, `in person`, `in-person`, `onsite`, `on-site`, `on site`, `face to face`, `face-to-face`

When this happens:

- The draft preview shows `📹 视频会议：无` and a sub-line `↳ 已根据"线下/办公室/现场"等表达关闭视频会议`.
- The successful `create_event` response will NOT include `meeting_url` or `meeting_no`.
- **Do NOT claim a meeting link exists** for these events, and do NOT tell the user to "点击加入会议" — there is no video conference.
- Pass `original_text` verbatim; the tool decides. Do not "auto-fix" by passing `enable_vchat: true` to override the user's intent.

## Date and Time Handling (C4.3 / C4.4 — Tool-Layer Correction + Enforced original_text)

The tool now performs **code-level relative-date correction** — you do not need to perfectly resolve Chinese relative dates yourself.

### REQUIRED: always pass `original_text` (enforced)

The tool **rejects** `create_event_draft` calls without `original_text`. Pass the user's verbatim message every time, regardless of whether the message contains a relative date.

The tool will:

1. Parse `original_text` to detect phrases like "明天".
2. Resolve the phrase to the correct Asia/Shanghai date (immune to server UTC timezone).
3. Auto-correct `start_time` / `end_time` if your resolved date was wrong.
4. Add a correction notice to the preview if a correction was made.

### Your responsibilities

- Provide your best-effort `start_time` / `end_time` in ISO 8601 with `+08:00` offset.
- Always include `original_text` — the tool will catch and fix date errors.
- Show the returned `preview` verbatim to the user (it includes any correction notice).
- If the preview shows `⚠️ 已根据原始文本将日期从 … 修正为 …`, present it as-is. Only proceed to `create_event` after the user confirms.

### Timezone

Always use `Asia/Shanghai` (+08:00) when constructing ISO timestamps. The server container runs UTC; the tool corrects for this.

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
  "start_time": "2026-05-15T15:00:00+08:00",
  "end_time": "2026-05-15T16:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "calendar_id": "optional — omit to use default",
  "description": "optional",
  "enable_vchat": true,
  "original_text": "帮我创建一个日程，明天下午3点，产品讨论，1小时"
}
```

Returns a `preview` string and a `draft_id`. Show the preview to the user as-is before asking for confirmation. **Save the `draft_id`** — you must pass it to `create_event`.

The preview will include:

- 标题、时间、时区、日历 ID
- `📹 视频会议：飞书会议`（enable_vchat=true）或 `📹 视频会议：无`（enable_vchat=false）
- `🗓️ 日期解析基准：Asia/Shanghai，今天是 YYYY-MM-DD`
- `⚠️ 已根据原始文本将日期从 … 修正为 …`（如有修正）
- `ℹ️ 未提供原始文本…`（如未提供 original_text）

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

**Bot (internal):** Best-effort: "明天" ≈ tomorrow. Pass `original_text` so the tool can auto-correct if wrong. Call `create_event_draft`:

```json
{
  "action": "create_event_draft",
  "title": "产品讨论",
  "start_time": "2026-05-15T15:00:00+08:00",
  "end_time": "2026-05-15T16:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "enable_vchat": true,
  "original_text": "帮我创建一个日程，明天下午3点，产品讨论，1小时"
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
- **meeting_url**（仅当响应里有此字段时）作为视频会议链接，供用户直接加入。线下会议响应中**不会**包含 `meeting_url`，此时**不要**编造或提及任何视频会议链接。
- **app_link**（如有）作为飞书日历深链，供用户在客户端查看日程
- 提示：日程已创建在 **Ainetrix Team Calendar**，团队成员可见。

If the response has `vchat_enabled: false` (or no `meeting_url`), do not say anything like "点击加入会议" or "视频会议链接" — there is no video conference for this event.

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
| `calendar:calendar.event:write` | `create_event` (Stage C4.3 — active) |
