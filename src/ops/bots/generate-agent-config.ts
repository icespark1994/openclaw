/**
 * Pure generator: BotSpec → agent config fragment.
 *
 * Produces a plain object compatible with AgentConfig (src/config/types.agents.ts).
 * The caller merges this into the full openclaw.json `agents.list[]` array.
 *
 * Stage 7B scope: generation only, no config file I/O.
 */

import type { BotSpec } from "./bot-spec.js";

/**
 * Minimal agent config fragment — subset of AgentConfig fields that a BotSpec controls.
 * Kept as a standalone type so this module doesn't import the full config tree.
 */
export type AgentConfigFragment = {
	id: string;
	name: string;
	model: string;
	skills?: string[];
	tools?: {
		allow?: string[];
		deny?: string[];
	};
};

/**
 * Convert a BotSpec into an agent config fragment.
 *
 * Mapping:
 *   spec.id          → agent.id
 *   spec.name        → agent.name
 *   spec.model.id    → agent.model  (AgentConfig accepts a plain string)
 *   spec.skills      → agent.skills (empty array = no skills; matches AgentConfig semantics)
 *   spec.tools       → agent.tools  (allowlist→allow, denylist→deny to match AgentToolsConfig)
 */
export function generateAgentConfig(spec: BotSpec): AgentConfigFragment {
	const fragment: AgentConfigFragment = {
		id: spec.id,
		name: spec.name,
		model: spec.model.id,
	};

	// Only set skills when the spec declares them (empty = none, which is intentional)
	if (spec.skills.length > 0 || spec.skills !== undefined) {
		fragment.skills = spec.skills;
	}

	// Map BotSpec tool names to AgentToolsConfig field names
	if (spec.tools) {
		const tools: AgentConfigFragment["tools"] = {};
		if (spec.tools.allowlist) tools.allow = spec.tools.allowlist;
		if (spec.tools.denylist) tools.deny = spec.tools.denylist;
		if (tools.allow || tools.deny) {
			fragment.tools = tools;
		}
	}

	return fragment;
}
