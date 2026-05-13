import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mocks before any imports that trigger module evaluation.
const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

import {
  buildEventDraft,
  createCalendarEvent,
  draftStore,
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

  beforeEach(() => {
    vi.clearAllMocks();
    createFeishuClientMock.mockReturnValue({
      calendar: {
        calendarEvent: {
          create: calendarEventCreateMock,
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
