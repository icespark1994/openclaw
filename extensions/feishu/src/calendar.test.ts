import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mocks before any imports that trigger module evaluation.
const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

import {
  addDays,
  applyRelativeDateCorrection,
  buildEventDraft,
  createCalendarEvent,
  detectRelativeDate,
  draftStore,
  getCurrentDateInTimezone,
  isUserAllowed,
  listCalendars,
  parseAllowedUsers,
  type DraftEntry,
} from "./calendar.js";

// ── buildEventDraft ───────────────────────────────────────────────────────────

describe("buildEventDraft", () => {
  it("returns all required fields", () => {
    const draft = buildEventDraft({
      title: "税务报表解析",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
    });
    expect(draft.title).toBe("税务报表解析");
    expect(draft.start_time).toBe("2026-05-16T13:00:00+08:00");
    expect(draft.end_time).toBe("2026-05-16T14:00:00+08:00");
    expect(draft.calendar_id).toBe("cal_abc123");
    expect(draft.timezone).toBe("Asia/Shanghai");
    expect(draft.attendees).toEqual([]);
    expect(draft.description).toBe("");
  });

  it("defaults enable_vchat to true", () => {
    const draft = buildEventDraft({
      title: "Meeting",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
    });
    expect(draft.enable_vchat).toBe(true);
  });

  it("sets enable_vchat false when explicitly disabled", () => {
    const draft = buildEventDraft({
      title: "Offline",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
      enable_vchat: false,
    });
    expect(draft.enable_vchat).toBe(false);
  });

  it("preview shows 飞书会议 when vchat enabled", () => {
    const draft = buildEventDraft({
      title: "Sync",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
    });
    expect(draft.preview).toContain("视频会议：飞书会议");
  });

  it("preview shows 无 when vchat disabled", () => {
    const draft = buildEventDraft({
      title: "Offline",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
      enable_vchat: false,
    });
    expect(draft.preview).toContain("视频会议：无");
  });

  it("uses provided timezone over default", () => {
    const draft = buildEventDraft({
      title: "Sync",
      start_time: "2026-05-16T08:00:00Z",
      end_time: "2026-05-16T09:00:00Z",
      timezone: "America/New_York",
      calendar_id: "cal_abc123",
    });
    expect(draft.timezone).toBe("America/New_York");
  });

  it("includes all event fields in preview text", () => {
    const draft = buildEventDraft({
      title: "税务报表解析",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
      calendar_id: "cal_abc123",
    });
    expect(draft.preview).toContain("税务报表解析");
    expect(draft.preview).toContain("2026-05-16T13:00:00+08:00");
    expect(draft.preview).toContain("2026-05-16T14:00:00+08:00");
    expect(draft.preview).toContain("cal_abc123");
    expect(draft.preview).toContain("Asia/Shanghai");
  });

  it("preview prompts user to confirm before creation", () => {
    const draft = buildEventDraft({
      title: "Test",
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
      calendar_id: "cal_xyz",
    });
    const text = draft.preview.toLowerCase();
    expect(text.includes("确认") || text.includes("confirm") || text.includes("yes")).toBe(true);
  });

  it("does NOT call any Feishu API", () => {
    buildEventDraft({
      title: "No API",
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
      calendar_id: "cal_abc123",
    });
    expect(createFeishuClientMock).not.toHaveBeenCalled();
  });

  it("preserves optional description", () => {
    const draft = buildEventDraft({
      title: "With Desc",
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
      calendar_id: "cal_abc123",
      description: "Agenda: review Q1 results",
    });
    expect(draft.description).toBe("Agenda: review Q1 results");
  });
});

// ── getCurrentDateInTimezone ──────────────────────────────────────────────────

describe("getCurrentDateInTimezone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Asia/Shanghai date when UTC midnight has not yet crossed midnight in Shanghai", () => {
    // 2026-05-14T15:00:00Z = 2026-05-14 23:00 Shanghai (still May 14)
    vi.setSystemTime(new Date("2026-05-14T15:00:00Z"));
    expect(getCurrentDateInTimezone("Asia/Shanghai")).toBe("2026-05-14");
  });

  it("returns Asia/Shanghai date one day ahead of UTC when UTC is before Shanghai midnight", () => {
    // 2026-05-14T17:00:00Z = 2026-05-15 01:00 Shanghai (already May 15)
    vi.setSystemTime(new Date("2026-05-14T17:00:00Z"));
    expect(getCurrentDateInTimezone("Asia/Shanghai")).toBe("2026-05-15");
  });

  it("returns correct date for a UTC container running midnight UTC on May 14", () => {
    // 2026-05-14T00:00:00Z = 2026-05-14 08:00 Shanghai
    vi.setSystemTime(new Date("2026-05-14T00:00:00Z"));
    expect(getCurrentDateInTimezone("Asia/Shanghai")).toBe("2026-05-14");
  });

  it("returns YYYY-MM-DD format", () => {
    vi.setSystemTime(new Date("2026-01-05T10:00:00Z"));
    const result = getCurrentDateInTimezone("Asia/Shanghai");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── buildEventDraft — date basis ──────────────────────────────────────────────

describe("buildEventDraft — current_date_in_timezone and preview date basis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock: 2026-05-14T01:00:00Z = 2026-05-14 09:00 Asia/Shanghai → today is 2026-05-14
    vi.setSystemTime(new Date("2026-05-14T01:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns current_date_in_timezone matching Asia/Shanghai today", () => {
    const draft = buildEventDraft({
      title: "线下会议",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.current_date_in_timezone).toBe("2026-05-14");
  });

  it("preview contains date basis line with today's Shanghai date", () => {
    const draft = buildEventDraft({
      title: "线下会议",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.preview).toContain("日期解析基准：Asia/Shanghai，今天是 2026-05-14");
  });

  it("明天 scenario: start on 2026-05-15 with today=2026-05-14 → current_date_in_timezone is 2026-05-14", () => {
    // User said "明天下午4点"; LLM should pass 2026-05-15T16:00:00+08:00
    const draft = buildEventDraft({
      title: "办公室讨论",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.current_date_in_timezone).toBe("2026-05-14");
    // start_time is one day after today — correct for "明天"
    expect(draft.start_time).toBe("2026-05-15T16:00:00+08:00");
    expect(draft.preview).toContain("2026-05-15T16:00:00+08:00");
    expect(draft.preview).toContain("今天是 2026-05-14");
  });

  it("今天 scenario: start on 2026-05-14 with today=2026-05-14 → current_date matches", () => {
    const draft = buildEventDraft({
      title: "今天会议",
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.current_date_in_timezone).toBe("2026-05-14");
    expect(draft.preview).toContain("2026-05-14T16:00:00+08:00");
    expect(draft.preview).toContain("今天是 2026-05-14");
  });

  it("后天 scenario: start on 2026-05-16 with today=2026-05-14", () => {
    const draft = buildEventDraft({
      title: "后天会议",
      start_time: "2026-05-16T16:00:00+08:00",
      end_time: "2026-05-16T16:30:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.current_date_in_timezone).toBe("2026-05-14");
    expect(draft.start_time).toBe("2026-05-16T16:00:00+08:00");
  });

  it("本周五 on Thursday 2026-05-14 → start should be 2026-05-15", () => {
    // 2026-05-14 is a Thursday; Friday = 2026-05-15
    const draft = buildEventDraft({
      title: "本周五会议",
      start_time: "2026-05-15T14:00:00+08:00",
      end_time: "2026-05-15T15:00:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.current_date_in_timezone).toBe("2026-05-14");
    expect(draft.start_time).toBe("2026-05-15T14:00:00+08:00");
    expect(draft.preview).toContain("今天是 2026-05-14");
  });

  it("preview format: date basis line appears between attendees line and confirm prompt", () => {
    const draft = buildEventDraft({
      title: "Test",
      start_time: "2026-05-15T10:00:00+08:00",
      end_time: "2026-05-15T11:00:00+08:00",
      calendar_id: "cal_abc",
    });
    const dateBasisIdx = draft.preview.indexOf("日期解析基准");
    const confirmIdx = draft.preview.indexOf("确认");
    expect(dateBasisIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(dateBasisIdx);
  });
});

// ── addDays ───────────────────────────────────────────────────────────────────

describe("addDays", () => {
  it("adds 1 day", () => {
    expect(addDays("2026-05-14", 1)).toBe("2026-05-15");
  });
  it("handles month boundary", () => {
    expect(addDays("2026-05-31", 1)).toBe("2026-06-01");
  });
  it("handles negative days", () => {
    expect(addDays("2026-05-14", -1)).toBe("2026-05-13");
  });
  it("adds 2 days (后天)", () => {
    expect(addDays("2026-05-14", 2)).toBe("2026-05-16");
  });
});

// ── detectRelativeDate ────────────────────────────────────────────────────────

describe("detectRelativeDate", () => {
  // 2026-05-14T01:00:00Z = 2026-05-14 09:00 Asia/Shanghai → today=2026-05-14 (Thursday)
  const MOCK_TIME = new Date("2026-05-14T01:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_TIME);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("今天 → today", () => {
    const r = detectRelativeDate("今天下午4点", "Asia/Shanghai");
    expect(r?.phrase).toBe("今天");
    expect(r?.resolvedDate).toBe("2026-05-14");
  });

  it("明天 → tomorrow", () => {
    const r = detectRelativeDate("帮我创建一个会议，明天下午4点", "Asia/Shanghai");
    expect(r?.phrase).toBe("明天");
    expect(r?.resolvedDate).toBe("2026-05-15");
  });

  it("后天 → day after tomorrow", () => {
    const r = detectRelativeDate("后天上午10点", "Asia/Shanghai");
    expect(r?.phrase).toBe("后天");
    expect(r?.resolvedDate).toBe("2026-05-16");
  });

  it("本周五 on Thursday 2026-05-14 → 2026-05-15 (Friday)", () => {
    const r = detectRelativeDate("本周五下午2点", "Asia/Shanghai");
    expect(r?.phrase).toBe("本周五");
    expect(r?.resolvedDate).toBe("2026-05-15");
  });

  it("本周一 on Thursday 2026-05-14 → 2026-05-11 (this Monday)", () => {
    const r = detectRelativeDate("本周一上午9点", "Asia/Shanghai");
    expect(r?.phrase).toBe("本周一");
    expect(r?.resolvedDate).toBe("2026-05-11");
  });

  it("下周一 on Thursday 2026-05-14 → 2026-05-18", () => {
    const r = detectRelativeDate("下周一上午10点开会", "Asia/Shanghai");
    expect(r?.phrase).toBe("下周一");
    expect(r?.resolvedDate).toBe("2026-05-18");
  });

  it("下周五 on Thursday 2026-05-14 → 2026-05-22", () => {
    const r = detectRelativeDate("下周五下午3点", "Asia/Shanghai");
    expect(r?.phrase).toBe("下周五");
    expect(r?.resolvedDate).toBe("2026-05-22");
  });

  it("下周日 on Thursday 2026-05-14 → 2026-05-24", () => {
    const r = detectRelativeDate("下周日", "Asia/Shanghai");
    expect(r?.phrase).toBe("下周日");
    expect(r?.resolvedDate).toBe("2026-05-24");
  });

  it("returns null for text with no relative date", () => {
    expect(detectRelativeDate("2026-05-20T10:00:00+08:00", "Asia/Shanghai")).toBeNull();
  });

  it("prefers 明天 over 本周X when both present (first match wins)", () => {
    // 明天 is checked before 本周, so it wins
    const r = detectRelativeDate("明天本周五", "Asia/Shanghai");
    expect(r?.phrase).toBe("明天");
  });
});

// ── applyRelativeDateCorrection ───────────────────────────────────────────────

describe("applyRelativeDateCorrection", () => {
  const MOCK_TIME = new Date("2026-05-14T01:00:00Z"); // Shanghai = 2026-05-14

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_TIME);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("corrects 明天 when LLM passed today (wrong date)", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      original_text: "帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-15T16:00:00+08:00");
    expect(result.end_time).toBe("2026-05-15T16:30:00+08:00");
    expect(result.correction?.corrected).toBe(true);
    expect(result.correction?.detected_phrase).toBe("明天");
    expect(result.correction?.expected_date).toBe("2026-05-15");
    expect(result.correction?.original_date).toBe("2026-05-14");
  });

  it("does not correct when LLM passed the correct date for 明天", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
      original_text: "明天下午4点",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-15T16:00:00+08:00");
    expect(result.end_time).toBe("2026-05-15T16:30:00+08:00");
    expect(result.correction?.corrected).toBe(false);
  });

  it("corrects 今天 when LLM passed wrong date", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-13T16:00:00+08:00",
      end_time: "2026-05-13T16:30:00+08:00",
      original_text: "今天下午4点",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-14T16:00:00+08:00");
    expect(result.end_time).toBe("2026-05-14T16:30:00+08:00");
    expect(result.correction?.corrected).toBe(true);
    expect(result.correction?.detected_phrase).toBe("今天");
  });

  it("corrects 后天 when LLM passed today (2 days off)", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      original_text: "后天下午4点",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-16T16:00:00+08:00");
    expect(result.end_time).toBe("2026-05-16T16:30:00+08:00");
    expect(result.correction?.corrected).toBe(true);
    expect(result.correction?.detected_phrase).toBe("后天");
  });

  it("corrects 本周五 on Thursday when LLM passed wrong date", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-14T14:00:00+08:00",
      end_time: "2026-05-14T15:00:00+08:00",
      original_text: "本周五下午2点",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-15T14:00:00+08:00");
    expect(result.end_time).toBe("2026-05-15T15:00:00+08:00");
    expect(result.correction?.corrected).toBe(true);
    expect(result.correction?.detected_phrase).toBe("本周五");
  });

  it("corrects 下周一 to 2026-05-18", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-14T10:00:00+08:00",
      end_time: "2026-05-14T11:00:00+08:00",
      original_text: "下周一上午10点开会",
      timezone: "Asia/Shanghai",
    });
    expect(result.start_time).toBe("2026-05-18T10:00:00+08:00");
    expect(result.end_time).toBe("2026-05-18T11:00:00+08:00");
    expect(result.correction?.detected_phrase).toBe("下周一");
    expect(result.correction?.expected_date).toBe("2026-05-18");
  });

  it("preserves duration when correcting (30-minute event)", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      original_text: "明天下午4点，30分钟",
      timezone: "Asia/Shanghai",
    });
    // Duration check: 30 minutes preserved across the date shift
    const newStart = new Date(result.start_time);
    const newEnd = new Date(result.end_time);
    expect(newEnd.getTime() - newStart.getTime()).toBe(30 * 60 * 1000);
  });

  it("returns null correction when text has no relative date", () => {
    const result = applyRelativeDateCorrection({
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
      original_text: "2026年5月16日上午10点",
      timezone: "Asia/Shanghai",
    });
    expect(result.correction).toBeNull();
    expect(result.start_time).toBe("2026-05-16T10:00:00+08:00");
  });
});

// ── buildEventDraft — original_text / correction ──────────────────────────────

describe("buildEventDraft — original_text correction", () => {
  const MOCK_TIME = new Date("2026-05-14T01:00:00Z"); // Shanghai = 2026-05-14

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_TIME);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("corrects start/end when LLM passes wrong date for '明天'", () => {
    const draft = buildEventDraft({
      title: "办公室讨论",
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      calendar_id: "cal_abc",
      original_text: "帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟",
    });
    expect(draft.start_time).toBe("2026-05-15T16:00:00+08:00");
    expect(draft.end_time).toBe("2026-05-15T16:30:00+08:00");
    expect(draft.relative_date_correction?.corrected).toBe(true);
  });

  it("preview shows correction warning when date was wrong", () => {
    const draft = buildEventDraft({
      title: "线下会议",
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      calendar_id: "cal_abc",
      original_text: "明天下午4点",
    });
    expect(draft.preview).toContain("已根据原始文本将日期从 2026-05-14 修正为 2026-05-15");
    expect(draft.preview).toContain("明天");
  });

  it("preview shows no correction warning when date was already correct", () => {
    const draft = buildEventDraft({
      title: "线下会议",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
      calendar_id: "cal_abc",
      original_text: "明天下午4点",
    });
    expect(draft.preview).not.toContain("修正");
    expect(draft.relative_date_correction?.corrected).toBe(false);
  });

  it("preview shows '未提供原始文本' warning when original_text is absent", () => {
    const draft = buildEventDraft({
      title: "Meeting",
      start_time: "2026-05-15T10:00:00+08:00",
      end_time: "2026-05-15T11:00:00+08:00",
      calendar_id: "cal_abc",
    });
    expect(draft.preview).toContain("未提供原始文本");
    expect(draft.relative_date_correction).toBeUndefined();
  });

  it("does not show '未提供原始文本' when original_text is provided but has no relative date", () => {
    const draft = buildEventDraft({
      title: "Meeting",
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
      calendar_id: "cal_abc",
      original_text: "2026年5月16日上午10点开会",
    });
    expect(draft.preview).not.toContain("未提供原始文本");
    expect(draft.preview).not.toContain("修正");
  });
});

// ── listCalendars ─────────────────────────────────────────────────────────────

describe("listCalendars", () => {
  const calendarListMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createFeishuClientMock.mockReturnValue({
      calendar: {
        calendar: {
          list: calendarListMock,
        },
      },
    });
  });

  it("returns error object when calendar API is unavailable", async () => {
    const clientWithoutCalendar = {};
    const result = (await listCalendars(clientWithoutCalendar as never)) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("calendar:calendar:readonly");
  });

  it("returns error object on non-zero API response code", async () => {
    calendarListMock.mockResolvedValue({ code: 403, msg: "no permission" });
    const client = createFeishuClientMock();
    const result = (await listCalendars(client)) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("403");
    expect(String(result.error)).toContain("calendar:calendar:readonly");
  });

  it("returns calendar list on success", async () => {
    calendarListMock.mockResolvedValue({
      code: 0,
      data: {
        calendar_list: [
          { calendar_id: "cal_001", summary: "Ainetrix Default", role: "owner" },
          { calendar_id: "cal_002", summary: "Shared", role: "editor" },
        ],
      },
    });
    const client = createFeishuClientMock();
    const result = (await listCalendars(client)) as { calendars: unknown[]; total: number };
    expect(result.calendars).toHaveLength(2);
    expect(result.total).toBe(2);
    const first = result.calendars[0] as { calendar_id: string; summary: string; role: string };
    expect(first.calendar_id).toBe("cal_001");
    expect(first.summary).toBe("Ainetrix Default");
  });

  it("returns empty list when calendar_list is absent", async () => {
    calendarListMock.mockResolvedValue({ code: 0, data: {} });
    const client = createFeishuClientMock();
    const result = (await listCalendars(client)) as { calendars: unknown[]; total: number };
    expect(result.calendars).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ── parseAllowedUsers / isUserAllowed ─────────────────────────────────────────

describe("parseAllowedUsers", () => {
  it("returns empty set for undefined", () => {
    expect(parseAllowedUsers(undefined).size).toBe(0);
  });

  it("returns empty set for empty string", () => {
    expect(parseAllowedUsers("").size).toBe(0);
  });

  it("parses comma-separated entries", () => {
    const set = parseAllowedUsers("feishu:ou_abc,telegram:12345");
    expect(set.has("feishu:ou_abc")).toBe(true);
    expect(set.has("telegram:12345")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("trims whitespace around entries", () => {
    const set = parseAllowedUsers("  feishu:ou_abc  , telegram:12345  ");
    expect(set.has("feishu:ou_abc")).toBe(true);
    expect(set.has("telegram:12345")).toBe(true);
  });
});

describe("isUserAllowed", () => {
  const allowed = new Set(["feishu:ou_abc", "telegram:12345"]);

  it("returns true for a matching channel:senderId entry", () => {
    expect(isUserAllowed("feishu", "ou_abc", allowed)).toBe(true);
    expect(isUserAllowed("telegram", "12345", allowed)).toBe(true);
  });

  it("returns false for non-matching user", () => {
    expect(isUserAllowed("feishu", "ou_other", allowed)).toBe(false);
  });

  it("returns false when channel is undefined and no agentId match", () => {
    expect(isUserAllowed(undefined, "ou_abc", allowed)).toBe(false);
  });

  it("returns false when senderId is undefined and no agentId match", () => {
    expect(isUserAllowed("feishu", undefined, allowed)).toBe(false);
  });

  it("returns false when allowedSet is empty", () => {
    expect(isUserAllowed("feishu", "ou_abc", new Set())).toBe(false);
  });

  it("returns true when agentId matches an agent: entry", () => {
    const agentAllowed = new Set(["agent:ainetrix_feishu", "feishu:ou_abc"]);
    // agentId match even when channel/senderId are undefined
    expect(isUserAllowed(undefined, undefined, agentAllowed, "ainetrix_feishu")).toBe(true);
    expect(isUserAllowed("feishu", undefined, agentAllowed, "ainetrix_feishu")).toBe(true);
  });

  it("returns false when agentId does not match any agent: entry", () => {
    const agentAllowed = new Set(["agent:other_agent"]);
    expect(isUserAllowed(undefined, undefined, agentAllowed, "ainetrix_feishu")).toBe(false);
  });

  it("returns true via channel:senderId even when agentId is absent", () => {
    expect(isUserAllowed("feishu", "ou_abc", allowed, undefined)).toBe(true);
  });
});

// ── createCalendarEvent ───────────────────────────────────────────────────────

describe("createCalendarEvent", () => {
  const calendarEventCreateMock = vi.fn();
  const calendarEventPatchMock = vi.fn().mockResolvedValue({ code: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
    calendarEventPatchMock.mockResolvedValue({ code: 0 });
    createFeishuClientMock.mockReturnValue({
      calendar: {
        calendarEvent: {
          create: calendarEventCreateMock,
          patch: calendarEventPatchMock,
        },
      },
    });
  });

  const entry: DraftEntry = {
    title: "税务报表解析",
    start_time: "2026-05-16T13:00:00+08:00",
    end_time: "2026-05-16T14:00:00+08:00",
    timezone: "Asia/Shanghai",
    calendar_id: "cal_feishu_default",
    description: "Quarterly review",
    enable_vchat: true,
    source_user: "ou_abc123",
    source_channel: "feishu",
    created_at: Date.now(),
  };

  it("returns error when calendarEvent API unavailable", async () => {
    const client = { calendar: {} } as never;
    const result = (await createCalendarEvent(client, "cal_id", entry)) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("calendar:calendar.event:write");
  });

  it("returns error on non-zero API response code", async () => {
    calendarEventCreateMock.mockResolvedValue({ code: 11502, msg: "no write permission" });
    const client = createFeishuClientMock();
    const result = (await createCalendarEvent(client, "cal_id", entry)) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("11502");
  });

  it("returns event_id, app_link, meeting_url on API success with vchat", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: {
        event: {
          event_id: "event_xyz",
          summary: "税务报表解析",
          start_time: { timestamp: "1747371600", timezone: "Asia/Shanghai" },
          end_time: { timestamp: "1747375200", timezone: "Asia/Shanghai" },
          app_link: "https://www.feishu.cn/calendar/event/xxx",
          vchat: {
            vc_type: "vc",
            meeting_url: "https://vc.feishu.cn/j/123456",
            vc_info: { unique_id: "uid_abc", meeting_no: "123456" },
          },
        },
      },
    });
    const client = createFeishuClientMock();
    const result = (await createCalendarEvent(client, "cal_feishu_default", entry)) as Record<
      string,
      unknown
    >;
    expect(result.success).toBe(true);
    expect(result.event_id).toBe("event_xyz");
    expect(result.calendar_id).toBe("cal_feishu_default");
    expect(result.app_link).toBe("https://www.feishu.cn/calendar/event/xxx");
    expect(result.meeting_url).toBe("https://vc.feishu.cn/j/123456");
    expect(result.meeting_no).toBe("123456");
    expect(result.vchat_enabled).toBe(true);
  });

  it("passes vc_type=vc to SDK when enable_vchat=true", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: { event: { event_id: "ev1", summary: "X", start_time: { timezone: "Asia/Shanghai" } } },
    });
    const client = createFeishuClientMock();
    await createCalendarEvent(client, "cal_id", { ...entry, enable_vchat: true });
    const callArg = calendarEventCreateMock.mock.calls[0][0];
    expect(callArg.data.vchat).toEqual({ vc_type: "vc" });
  });

  it("passes vc_type=no_meeting to SDK when enable_vchat=false", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: { event: { event_id: "ev2", summary: "X", start_time: { timezone: "Asia/Shanghai" } } },
    });
    const client = createFeishuClientMock();
    await createCalendarEvent(client, "cal_id", { ...entry, enable_vchat: false });
    const callArg = calendarEventCreateMock.mock.calls[0][0];
    expect(callArg.data.vchat).toEqual({ vc_type: "no_meeting" });
  });

  it("patches description with meeting_url when vchat enabled and meeting_url returned", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: {
        event: {
          event_id: "ev_patch",
          summary: "X",
          start_time: { timezone: "Asia/Shanghai" },
          vchat: { vc_type: "vc", meeting_url: "https://vc.feishu.cn/j/12345" },
        },
      },
    });
    const client = createFeishuClientMock();
    await createCalendarEvent(client, "cal_id", { ...entry, enable_vchat: true });
    expect(calendarEventPatchMock).toHaveBeenCalledOnce();
    const patchArg = calendarEventPatchMock.mock.calls[0][0];
    expect(patchArg.data.description).toContain("https://vc.feishu.cn/j/12345");
    expect(patchArg.path.event_id).toBe("ev_patch");
  });

  it("does not patch description when enable_vchat=false", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: { event: { event_id: "ev3", summary: "X", start_time: { timezone: "Asia/Shanghai" } } },
    });
    const client = createFeishuClientMock();
    await createCalendarEvent(client, "cal_id", { ...entry, enable_vchat: false });
    expect(calendarEventPatchMock).not.toHaveBeenCalled();
  });

  it("returns error when code=0 but event_id is absent", async () => {
    calendarEventCreateMock.mockResolvedValue({ code: 0, data: { event: {} } });
    const client = createFeishuClientMock();
    const result = (await createCalendarEvent(client, "cal_id", entry)) as Record<string, unknown>;
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("no event_id");
  });
});

// ── create_event_draft via tool (C4) ─────────────────────────────────────────

describe("create_event_draft via registerFeishuCalendarTools (C4)", () => {
  afterEach(() => {
    draftStore.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  function buildMockApi(
    overrides: {
      requesterSenderId?: string;
      messageChannel?: string;
    } = {},
  ) {
    const toolFactories: Array<(ctx: unknown) => { name: string; execute: Function }> = [];
    const mockApi = {
      config: {
        channels: {
          feishu: {
            enabled: true,
            accounts: {
              default: {
                enabled: true,
                appId: "test_app_id",
                appSecret: "test_app_secret",
              },
            },
          },
        },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: (factory: (ctx: unknown) => unknown, _opts?: unknown) => {
        toolFactories.push(factory as (ctx: unknown) => { name: string; execute: Function });
      },
    };
    return { mockApi, toolFactories, overrides };
  }

  it("create_event_draft returns draft_id", async () => {
    vi.stubEnv("AINETRIX_FEISHU_DEFAULT_CALENDAR_ID", "cal_default");
    const { mockApi, toolFactories } = buildMockApi();
    const { registerFeishuCalendarTools } = await import("./calendar.js");
    registerFeishuCalendarTools(mockApi as never);

    const tool = toolFactories[0]!({
      agentAccountId: undefined,
      requesterSenderId: "ou_abc",
      messageChannel: "feishu",
    });
    const result = await tool.execute("call-1", {
      action: "create_event_draft",
      title: "Tax Review",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.draft).toBeDefined();
    const draft = parsed.draft as Record<string, unknown>;
    expect(typeof draft.draft_id).toBe("string");
    expect(draft.draft_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("create_event_draft stores draft in draftStore", async () => {
    vi.stubEnv("AINETRIX_FEISHU_DEFAULT_CALENDAR_ID", "cal_default");
    const { mockApi, toolFactories } = buildMockApi();
    const { registerFeishuCalendarTools } = await import("./calendar.js");
    registerFeishuCalendarTools(mockApi as never);

    expect(draftStore.size).toBe(0);
    const tool = toolFactories[0]!({
      agentAccountId: undefined,
      requesterSenderId: "ou_abc",
      messageChannel: "feishu",
    });
    await tool.execute("call-1", {
      action: "create_event_draft",
      title: "Tax Review",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
    });
    expect(draftStore.size).toBe(1);
  });

  it("create_event_draft does NOT call any Feishu API", async () => {
    vi.stubEnv("AINETRIX_FEISHU_DEFAULT_CALENDAR_ID", "cal_default");
    createFeishuClientMock.mockReturnValue({});
    const { mockApi, toolFactories } = buildMockApi();
    const { registerFeishuCalendarTools } = await import("./calendar.js");
    registerFeishuCalendarTools(mockApi as never);

    const tool = toolFactories[0]!({ agentAccountId: undefined });
    await tool.execute("call-1", {
      action: "create_event_draft",
      title: "Tax Review",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
    });
    expect(createFeishuClientMock).not.toHaveBeenCalled();
  });
});

// ── create_event via tool (C4) ────────────────────────────────────────────────

describe("create_event via registerFeishuCalendarTools (C4)", () => {
  const calendarEventCreateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    draftStore.clear();
    createFeishuClientMock.mockReturnValue({
      calendar: { calendarEvent: { create: calendarEventCreateMock } },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    draftStore.clear();
  });

  async function buildTool(
    opts: {
      requesterSenderId?: string;
      messageChannel?: string;
      allowedUsers?: string;
    } = {},
  ) {
    vi.stubEnv("AINETRIX_FEISHU_DEFAULT_CALENDAR_ID", "cal_default");
    if (opts.allowedUsers !== undefined) {
      vi.stubEnv("AINETRIX_CALENDAR_ALLOWED_USERS", opts.allowedUsers);
    } else {
      // Default: Alan is allowed
      vi.stubEnv("AINETRIX_CALENDAR_ALLOWED_USERS", "feishu:ou_abc");
    }

    const toolFactories: Array<(ctx: unknown) => { name: string; execute: Function }> = [];
    const mockApi = {
      config: {
        channels: {
          feishu: {
            enabled: true,
            accounts: { default: { enabled: true, appId: "x", appSecret: "y" } },
          },
        },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: (factory: (ctx: unknown) => unknown, _opts?: unknown) => {
        toolFactories.push(factory as (ctx: unknown) => { name: string; execute: Function });
      },
    };
    const { registerFeishuCalendarTools } = await import("./calendar.js");
    registerFeishuCalendarTools(mockApi as never);

    const ctx = {
      agentAccountId: undefined,
      requesterSenderId: opts.requesterSenderId ?? "ou_abc",
      messageChannel: opts.messageChannel ?? "feishu",
    };
    return toolFactories[0]!(ctx);
  }

  async function createDraft(tool: { execute: Function }): Promise<string> {
    const result = await tool.execute("draft-call", {
      action: "create_event_draft",
      title: "Tax Review",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { draft: { draft_id: string } };
    return parsed.draft.draft_id;
  }

  it("rejects create_event without draft_id", async () => {
    const tool = await buildTool();
    const result = await tool.execute("call-1", { action: "create_event" });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("draft_id is required");
  });

  it("rejects create_event with nonexistent draft_id", async () => {
    const tool = await buildTool();
    const result = await tool.execute("call-1", {
      action: "create_event",
      draft_id: "does-not-exist",
    });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("not found");
  });

  it("rejects create_event when draft is expired (>30 min)", async () => {
    const tool = await buildTool();
    const draftId = await createDraft(tool);

    // Backdate the draft's created_at to 31 minutes ago
    const entry = draftStore.get(draftId)!;
    draftStore.set(draftId, { ...entry, created_at: Date.now() - 31 * 60 * 1000 });

    const result = await tool.execute("call-2", { action: "create_event", draft_id: draftId });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("expired");
  });

  it("rejects create_event when AINETRIX_CALENDAR_ALLOWED_USERS is not set", async () => {
    vi.stubEnv("AINETRIX_FEISHU_DEFAULT_CALENDAR_ID", "cal_default");
    vi.stubEnv("AINETRIX_CALENDAR_ALLOWED_USERS", "");

    const toolFactories: Array<(ctx: unknown) => { name: string; execute: Function }> = [];
    const mockApi = {
      config: {
        channels: {
          feishu: {
            enabled: true,
            accounts: { default: { enabled: true, appId: "x", appSecret: "y" } },
          },
        },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: (factory: (ctx: unknown) => unknown, _opts?: unknown) => {
        toolFactories.push(factory as (ctx: unknown) => { name: string; execute: Function });
      },
    };
    const { registerFeishuCalendarTools } = await import("./calendar.js");
    registerFeishuCalendarTools(mockApi as never);

    const tool = toolFactories[0]!({
      agentAccountId: undefined,
      requesterSenderId: "ou_abc",
      messageChannel: "feishu",
    });
    const draftId = await createDraft(tool);
    const result = await tool.execute("call-2", { action: "create_event", draft_id: draftId });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("AINETRIX_CALENDAR_ALLOWED_USERS");
  });

  it("rejects create_event when user not in AINETRIX_CALENDAR_ALLOWED_USERS", async () => {
    // Tool built with "feishu:ou_other" as allowed, but user is "ou_abc"
    const tool = await buildTool({ allowedUsers: "feishu:ou_other", requesterSenderId: "ou_abc" });
    const draftId = await createDraft(tool);
    const result = await tool.execute("call-2", { action: "create_event", draft_id: draftId });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("not authorized");
  });

  it("calls Feishu API when user is in allowlist and draft is valid", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: {
        event: {
          event_id: "event_001",
          summary: "Tax Review",
          start_time: { timestamp: "1747371600", timezone: "Asia/Shanghai" },
          end_time: { timestamp: "1747375200", timezone: "Asia/Shanghai" },
        },
      },
    });
    const tool = await buildTool();
    const draftId = await createDraft(tool);
    const result = await tool.execute("call-2", { action: "create_event", draft_id: draftId });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.event_id).toBe("event_001");
    expect(calendarEventCreateMock).toHaveBeenCalledOnce();
  });

  it("deletes draft after successful creation (prevents duplicate)", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: { event: { event_id: "event_002", summary: "Tax Review" } },
    });
    const tool = await buildTool();
    const draftId = await createDraft(tool);
    expect(draftStore.has(draftId)).toBe(true);

    await tool.execute("call-2", { action: "create_event", draft_id: draftId });
    expect(draftStore.has(draftId)).toBe(false);

    // Second attempt must fail
    const result2 = await tool.execute("call-3", { action: "create_event", draft_id: draftId });
    const parsed2 = JSON.parse(result2.content[0].text) as Record<string, unknown>;
    expect(parsed2.error).toBeDefined();
    expect(String(parsed2.error)).toContain("not found");
  });

  it("does not support attendees in create_event_draft", async () => {
    const tool = await buildTool();
    const result = await tool.execute("draft-call", {
      action: "create_event_draft",
      title: "No Attendees",
      start_time: "2026-05-16T13:00:00+08:00",
      end_time: "2026-05-16T14:00:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { draft: Record<string, unknown> };
    expect(parsed.draft.attendees).toEqual([]);
  });

  it("list_calendars still works", async () => {
    createFeishuClientMock.mockReturnValue({
      calendar: {
        calendar: {
          list: vi.fn().mockResolvedValue({
            code: 0,
            data: { calendar_list: [{ calendar_id: "cal_001", summary: "Main", role: "owner" }] },
          }),
        },
        calendarEvent: { create: calendarEventCreateMock },
      },
    });
    const tool = await buildTool();
    const result = await tool.execute("list-call", { action: "list_calendars" });
    const parsed = JSON.parse(result.content[0].text) as { calendars: unknown[] };
    expect(parsed.calendars).toHaveLength(1);
  });

  it("create_event_draft corrects '明天' when LLM passes wrong date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T01:00:00Z")); // Shanghai = 2026-05-14
    const tool = await buildTool();
    const result = await tool.execute("draft-correct", {
      action: "create_event_draft",
      title: "办公室讨论",
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      original_text: "帮我创建一个线下会议，明天下午4点，办公室讨论，30分钟",
    });
    const parsed = JSON.parse(result.content[0].text) as {
      draft: Record<string, unknown>;
      preview: string;
    };
    const draft = parsed.draft as Record<string, unknown>;
    // Tool must correct to 2026-05-15
    expect(draft.start_time).toBe("2026-05-15T16:00:00+08:00");
    expect(draft.end_time).toBe("2026-05-15T16:30:00+08:00");
    expect(parsed.preview).toContain("已根据原始文本将日期从 2026-05-14 修正为 2026-05-15");
    const correction = draft.relative_date_correction as Record<string, unknown>;
    expect(correction?.corrected).toBe(true);
    vi.useRealTimers();
  });

  it("create_event uses corrected times from draft (not original LLM times)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T01:00:00Z")); // Shanghai = 2026-05-14
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: {
        event: {
          event_id: "evt_corrected",
          summary: "办公室讨论",
          start_time: { timezone: "Asia/Shanghai" },
        },
      },
    });
    const tool = await buildTool();
    // Draft created with wrong date — tool corrects to May 15
    const draftResult = await tool.execute("draft-cor", {
      action: "create_event_draft",
      title: "办公室讨论",
      start_time: "2026-05-14T16:00:00+08:00",
      end_time: "2026-05-14T16:30:00+08:00",
      original_text: "明天下午4点办公室讨论",
    });
    const draftParsed = JSON.parse(draftResult.content[0].text) as {
      draft: { draft_id: string; start_time: string };
    };
    expect(draftParsed.draft.start_time).toBe("2026-05-15T16:00:00+08:00");
    const draftId = draftParsed.draft.draft_id;

    // Keep fake timers active so the draft's created_at is still within TTL
    await tool.execute("create-cor", { action: "create_event", draft_id: draftId });
    const callArg = calendarEventCreateMock.mock.calls[0][0];
    // Corrected start_time 2026-05-15T16:00:00+08:00
    const expectedTs = String(Math.floor(new Date("2026-05-15T16:00:00+08:00").getTime() / 1000));
    expect(callArg.data.start_time.timestamp).toBe(expectedTs);
    vi.useRealTimers();
  });

  it("create_event_draft without original_text shows 未提供原始文本 in preview", async () => {
    const tool = await buildTool();
    const result = await tool.execute("draft-no-text", {
      action: "create_event_draft",
      title: "Meeting",
      start_time: "2026-05-16T10:00:00+08:00",
      end_time: "2026-05-16T11:00:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { preview: string };
    expect(parsed.preview).toContain("未提供原始文本");
  });

  it("create_event_draft response includes current_date_in_timezone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T01:00:00Z")); // Shanghai = 2026-05-14
    const tool = await buildTool();
    const result = await tool.execute("draft-date", {
      action: "create_event_draft",
      title: "日期基准测试",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { draft: Record<string, unknown> };
    expect(parsed.draft.current_date_in_timezone).toBe("2026-05-14");
    vi.useRealTimers();
  });

  it("create_event_draft preview contains date basis line", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T01:00:00Z")); // Shanghai = 2026-05-14
    const tool = await buildTool();
    const result = await tool.execute("draft-preview-date", {
      action: "create_event_draft",
      title: "Preview日期测试",
      start_time: "2026-05-15T16:00:00+08:00",
      end_time: "2026-05-15T16:30:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { preview: string };
    expect(parsed.preview).toContain("日期解析基准：Asia/Shanghai，今天是 2026-05-14");
    vi.useRealTimers();
  });

  it("draft preview contains 飞书会议 by default", async () => {
    const tool = await buildTool();
    const result = await tool.execute("draft-call", {
      action: "create_event_draft",
      title: "产品讨论",
      start_time: "2026-05-16T15:00:00+08:00",
      end_time: "2026-05-16T16:00:00+08:00",
    });
    const parsed = JSON.parse(result.content[0].text) as { preview: string };
    expect(parsed.preview).toContain("视频会议：飞书会议");
  });

  it("draft preview contains 视频会议：无 when enable_vchat=false", async () => {
    const tool = await buildTool();
    const result = await tool.execute("draft-call", {
      action: "create_event_draft",
      title: "线下会议",
      start_time: "2026-05-16T15:00:00+08:00",
      end_time: "2026-05-16T16:00:00+08:00",
      enable_vchat: false,
    });
    const parsed = JSON.parse(result.content[0].text) as { preview: string };
    expect(parsed.preview).toContain("视频会议：无");
  });

  it("create_event passes vchat to SDK and returns meeting_url", async () => {
    calendarEventCreateMock.mockResolvedValue({
      code: 0,
      data: {
        event: {
          event_id: "event_vc1",
          summary: "产品讨论",
          start_time: { timezone: "Asia/Shanghai" },
          vchat: { vc_type: "vc", meeting_url: "https://vc.feishu.cn/j/999" },
        },
      },
    });
    const tool = await buildTool();
    const draftId = await createDraft(tool);
    const result = await tool.execute("call-vc", { action: "create_event", draft_id: draftId });
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.success).toBe(true);
    expect(parsed.meeting_url).toBe("https://vc.feishu.cn/j/999");
    expect(parsed.vchat_enabled).toBe(true);
    // SDK was called with vchat.vc_type="vc"
    const callArg = calendarEventCreateMock.mock.calls[0][0];
    expect(callArg.data.vchat).toEqual({ vc_type: "vc" });
  });
});
