/**
 * Lifecycle Plan — assembles all deployment materials for a single bot.
 *
 * Composes the Stage 7B generators (agent config, env, compose service)
 * into one cohesive plan object.  The plan is a pure data structure;
 * it does not execute anything.
 *
 * Stage 7C.2 scope: plan generation only.  No docker, no start/stop.
 */

import type { BotSpec } from "./bot-spec.js";
import { generateAgentConfig, type AgentConfigFragment } from "./generate-agent-config.js";
import { generateBotConfig, type BotContainerConfig } from "./generate-bot-config.js";
import {
  generateComposeService,
  type ComposeServiceFragment,
  type GenerateComposeOptions,
} from "./generate-compose-service.js";
import { generateEnv } from "./generate-env.js";

/** All deployment materials needed to run a single bot. */
export type LifecyclePlan = {
  /** Bot identifier (mirrors spec.id). */
  botId: string;
  /**
   * Execution runtime for this bot.
   * Mirrors spec.runtime — "docker" (default) or "in-process".
   */
  runtime: "docker" | "in-process";
  /** Whether the bot is enabled for deployment. */
  enabled: boolean;
  /** Agent config fragment for openclaw.json agents.list[]. */
  agentConfig: AgentConfigFragment;
  /** Environment variables for the bot container. */
  env: Record<string, string>;
  /** Docker-compose service definition. */
  composeService: ComposeServiceFragment;
  /**
   * Generated openclaw.json content for docker-runtime bots.
   * Written to {configDir}/{botId}/openclaw.json before container start.
   * null for in-process bots (they share the main process config).
   */
  botConfig: BotContainerConfig | null;
  /**
   * Path to an existing docker compose project directory.
   * When present, stop/restart use --project-directory instead of a
   * generated temporary compose file.  Mirrors spec.composeProjectDir.
   */
  composeProjectDir?: string;
  /**
   * Override for the Docker container name used by docker inspect.
   * When present, overrides the default `openclaw-<id>` container name.
   * Mirrors spec.containerName.
   */
  containerName?: string;
};

export type PlanOptions = GenerateComposeOptions;

/**
 * Generate a complete lifecycle plan for a bot.
 *
 * Pure function: BotSpec + options in, LifecyclePlan out.
 * The caller decides what to do with the plan (write files, diff, preview, deploy).
 */
export function planBotLifecycle(spec: BotSpec, options: PlanOptions = {}): LifecyclePlan {
  const runtime = spec.runtime ?? "docker";
  return {
    botId: spec.id,
    runtime,
    enabled: spec.enabled,
    agentConfig: generateAgentConfig(spec),
    env: generateEnv(spec, options),
    composeService: generateComposeService(spec, options),
    botConfig: runtime === "docker" ? generateBotConfig(spec) : null,
    composeProjectDir: spec.composeProjectDir,
    containerName: spec.containerName,
  };
}
