import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mocks before any imports that trigger module evaluation.
const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

import { buildEventDraft, listCalendars } from "./calendar.js";

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
    // Must contain some form of confirmation prompt
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

// ── create_event stub guard ────────────────────────────────────────────────────

describe("create_event stub", () => {
  const listCalendarsMock2 = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createFeishuClientMock.mockReturnValue({
      calendar: { calendar: { list: listCalendarsMock2 } },
    });
  });

  it("registerFeishuCalendarTools wires create_event as a stub", async () => {
    const { registerFeishuCalendarTools } = await import("./calendar.js");

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

    registerFeishuCalendarTools(mockApi as never);
    expect(toolFactories).toHaveLength(1);

    const tool = toolFactories[0]!({ agentAccountId: undefined });
    expect(tool.name).toBe("feishu_calendar");

    // create_event must return stub error, not call any real API
    const result = await tool.execute("call-1", { action: "create_event" });
    const text = result.content[0].text as string;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.error).toBeDefined();
    expect(String(parsed.error)).toContain("C4");

    // Confirm no Lark SDK calendar write was attempted
    expect(listCalendarsMock2).not.toHaveBeenCalled();
  });
});
