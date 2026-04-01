/**
 * In-process bot registry — runtime registry for bots that run within
 * the main process (no separate container).
 *
 * Bots register themselves via registerInProcessBot() at startup (side effect).
 * Dispatch calls routeMessageToInProcessBots() with no knowledge of which bots
 * are registered — all routing decisions are internal to each bot.
 *
 * Stage 11B scope: generic registry + routing only.
 * No docker, no compose, no finance-specific logic.
 */

// ── Interface ────────────────────────────────────────────────────────────────

export interface InProcessBot {
  /** Unique bot identifier (matches BotSpec.id convention). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Skill IDs this bot exposes (used for /bot-list display and /bot-invoke dispatch). */
  readonly skills: readonly string[];

  /**
   * Handle an incoming message.
   *
   * routeType and target come directly from classifyMessage — each bot interprets
   * them to decide if the message is a new request for its domain.
   * Returns a reply string if handled, or null to pass to the next bot / LLM chain.
   */
  handleMessage(
    text: string,
    sessionKey: string,
    routeType: string,
    target: string | null,
  ): Promise<string | null>;

  /** Whether the bot is currently accepting messages. */
  getStatus(): "running" | "stopped";

  /** Resume accepting messages (idempotent). */
  restart(): void;

  /** Stop accepting messages (idempotent). Pending drafts are preserved. */
  stop(): void;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, InProcessBot>();

/** Register an in-process bot. Overwrites any prior registration for the same id. */
export function registerInProcessBot(bot: InProcessBot): void {
  registry.set(bot.id, bot);
}

/** Look up a registered bot by id. Returns undefined if not found. */
export function getInProcessBot(id: string): InProcessBot | undefined {
  return registry.get(id);
}

/** Return all registered in-process bots (insertion order). */
export function listInProcessBots(): InProcessBot[] {
  return [...registry.values()];
}

// ── Generic message router ────────────────────────────────────────────────────

/**
 * Route a message through all running in-process bots.
 *
 * Iterates registered bots in insertion order.  Returns the first non-null
 * reply, or null if no bot handled the message.
 *
 * Call sites pass routeType + target from classifyMessage and do not need
 * to know which bots are registered.
 */
export async function routeMessageToInProcessBots(
  text: string,
  sessionKey: string,
  routeType: string,
  target: string | null,
): Promise<string | null> {
  for (const bot of registry.values()) {
    if (bot.getStatus() !== "running") {
      continue;
    }
    const reply = await bot.handleMessage(text, sessionKey, routeType, target);
    if (reply !== null) {
      return reply;
    }
  }
  return null;
}
