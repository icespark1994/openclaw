/**
 * Pure generator: BotSpec → openclaw.json content for a docker-runtime bot container.
 *
 * The generated config is written to {configDir}/{spec.id}/openclaw.json
 * before `docker compose up`.  It provides:
 *   - Telegram account wired to the bot's token file (container-internal path)
 *   - Agent configuration (skills, model, tools)
 *
 * The host-side token file is volume-mounted by the compose generator.
 * This file never contains the token value — only an in-container path reference.
 *
 * Stage 11C scope: docker-runtime bots only.
 */

import type { BotSpec } from "./bot-spec.js";
import { generateAgentConfig, type AgentConfigFragment } from "./generate-agent-config.js";

// ── Output type ───────────────────────────────────────────────────────────────

/** Minimal openclaw.json written into the bot container's config directory. */
export type BotContainerConfig = {
  channels: {
    telegram: {
      accounts: {
        default: {
          /** In-container path to the token file (volume-mounted from host). */
          tokenFile: string;
          /** Telegram user IDs permitted to message this bot. */
          allowFrom?: Array<string | number>;
          enabled: true;
        };
      };
    };
  };
  agents: {
    list: AgentConfigFragment[];
  };
};

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Generate the openclaw.json content for a docker-runtime bot.
 *
 * Token file in-container path is always:
 *   /home/node/.openclaw/secrets/<spec.id>.telegram-token
 *
 * The corresponding host-side file is specified by spec.telegram.tokenFile
 * and volume-mounted by generateComposeService().
 */
export function generateBotConfig(spec: BotSpec): BotContainerConfig {
  const containerTokenFile = `/home/node/.openclaw/secrets/${spec.id}.telegram-token`;

  return {
    channels: {
      telegram: {
        accounts: {
          default: {
            tokenFile: containerTokenFile,
            ...(spec.telegram?.allowFrom && spec.telegram.allowFrom.length > 0
              ? { allowFrom: spec.telegram.allowFrom }
              : {}),
            enabled: true,
          },
        },
      },
    },
    agents: {
      list: [generateAgentConfig(spec)],
    },
  };
}
