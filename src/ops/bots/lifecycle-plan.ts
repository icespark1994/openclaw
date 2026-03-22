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
import { generateEnv } from "./generate-env.js";
import { generateComposeService, type ComposeServiceFragment, type GenerateComposeOptions } from "./generate-compose-service.js";

/** All deployment materials needed to run a single bot. */
export type LifecyclePlan = {
	/** Bot identifier (mirrors spec.id). */
	botId: string;
	/** Whether the bot is enabled for deployment. */
	enabled: boolean;
	/** Agent config fragment for openclaw.json agents.list[]. */
	agentConfig: AgentConfigFragment;
	/** Environment variables for the bot container. */
	env: Record<string, string>;
	/** Docker-compose service definition. */
	composeService: ComposeServiceFragment;
};

export type PlanOptions = GenerateComposeOptions;

/**
 * Generate a complete lifecycle plan for a bot.
 *
 * Pure function: BotSpec + options in, LifecyclePlan out.
 * The caller decides what to do with the plan (write files, diff, preview, deploy).
 */
export function planBotLifecycle(spec: BotSpec, options: PlanOptions = {}): LifecyclePlan {
	return {
		botId: spec.id,
		enabled: spec.enabled,
		agentConfig: generateAgentConfig(spec),
		env: generateEnv(spec, options),
		composeService: generateComposeService(spec, options),
	};
}
