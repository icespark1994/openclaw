/**
 * Deploy Guardrails — pre-deploy checks to catch common conflicts.
 *
 * Pure functions: BotSpec + existing registry → pass/fail.
 * No side effects, no docker, no file writes.
 *
 * Stage 8C.4 scope: guardrails only.  No auto-resolution.
 */

import type { BotSpec } from "./bot-spec.js";

export type GuardResult =
	| { ok: true }
	| { ok: false; reason: string };

/**
 * Check a spec against the existing registry for conflicts.
 *
 * Rules:
 *   1. Bot ID must not already exist in the registry.
 *   2. gatewayPort (if set) must not collide with another registered bot.
 */
export function checkDeployGuards(spec: BotSpec, existingSpecs: readonly BotSpec[]): GuardResult {
	// 1. Duplicate ID
	const idMatch = existingSpecs.find((s) => s.id === spec.id);
	if (idMatch) {
		return { ok: false, reason: `Bot id "${spec.id}" already exists.` };
	}

	// 2. Port conflict
	if (spec.gatewayPort) {
		const portMatch = existingSpecs.find((s) => s.gatewayPort === spec.gatewayPort);
		if (portMatch) {
			return {
				ok: false,
				reason: `Port ${spec.gatewayPort} is already used by bot "${portMatch.id}".`,
			};
		}
	}

	return { ok: true };
}
