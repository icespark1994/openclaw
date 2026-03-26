// Stage 10-B: Skill handler registry.
// Each handler receives the original message text and a SkillContext object.
// Handlers are async to allow future I/O (API calls, DB reads, etc.).

import { financeHandler } from "../skills/finance/finance-handler.js";

// ---------------------------------------------------------------------------
// SkillContext — passed to every handler; extend here instead of changing
// the SkillHandler signature again.
// ---------------------------------------------------------------------------

export interface SkillContext {
  /** Composite session key (chatId or chatId:threadId for forum topics). */
  sessionKey: string;
  chatId: number;
  threadId?: number;
}

export type SkillHandler = (text: string, ctx: SkillContext) => Promise<string>;

export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  finance: financeHandler, // Stage 10-D/E: real parser + sheet write
  news: async (text, _ctx) => `news skill invoked: ${text}`,
};
