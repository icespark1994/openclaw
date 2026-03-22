/**
 * Skill Dispatch — minimal extensible skill handler registry.
 *
 * Design goals (Stage 9A):
 *   - Map skill ID strings to handler functions
 *   - Currently registers only finance/expense_v1
 *   - Adding a second skill requires only calling registerSkill() — no changes
 *     to control-service or any other call-site
 *
 * Handler contract:
 *   (message: string) => Promise<SkillInvokeResult>
 *
 * The registry is populated at module load so control-service can import and
 * use it without any additional wiring.
 */

import { classifyExpense, formatExpenseResult } from "./expense-adapter.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Standardized return value from any skill handler. */
export type SkillInvokeResult = {
	ok: boolean;
	/** Human-readable output to relay back to the user. */
	output: string;
};

/** All skill handlers share this signature. */
export type SkillHandler = (message: string) => Promise<SkillInvokeResult>;

// ── Registry ──────────────────────────────────────────────────────────────

const skillRegistry = new Map<string, SkillHandler>();

/**
 * Register a skill handler by ID.
 * Overwrites any existing registration for that ID.
 */
export function registerSkill(skillId: string, handler: SkillHandler): void {
	skillRegistry.set(skillId, handler);
}

/**
 * Dispatch a message to the handler registered for the given skill ID.
 *
 * Returns an error result (ok: false) if no handler is registered.
 */
export async function dispatchSkill(
	skillId: string,
	message: string,
): Promise<SkillInvokeResult> {
	const handler = skillRegistry.get(skillId);
	if (!handler) {
		return {
			ok: false,
			output: `No handler registered for skill "${skillId}".`,
		};
	}
	return handler(message);
}

/**
 * Return the set of currently registered skill IDs.
 * Useful for diagnostics and testing.
 */
export function registeredSkillIds(): string[] {
	return [...skillRegistry.keys()];
}

// ── Built-in registrations ────────────────────────────────────────────────

// finance/expense_v1 → expense adapter
registerSkill("finance/expense_v1", async (message) => {
	const result = await classifyExpense(message);
	if (!result.ok) {
		return { ok: false, output: `Expense classification failed: ${result.error}` };
	}
	return { ok: true, output: formatExpenseResult(result.data) };
});
