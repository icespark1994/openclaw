// Stage 10-B: Skill handler registry.
// Each handler receives the original message text and returns a reply string.
// Handlers are async to allow future I/O (API calls, DB reads, etc.).

export type SkillHandler = (text: string) => Promise<string>;

export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  finance: async (text) => `finance skill invoked: ${text}`,
  news: async (text) => `news skill invoked: ${text}`,
};
