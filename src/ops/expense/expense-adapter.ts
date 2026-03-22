/**
 * Expense Adapter — wraps the finance/expense_v1 skill.
 *
 * Responsibilities:
 *   - Locate and read the skill's prompt.md
 *   - Call the AI model (via @mariozechner/pi-ai) with the system prompt + user message
 *   - Parse and validate the JSON response against the 6-field schema
 *   - Return a typed result or structured error
 *
 * Non-responsibilities (Stage 9A):
 *   - Storage, audit trail, export, batch, multi-turn orchestration
 *
 * Skills root is resolved from AINETRIX_SKILLS_DIR env var or the sibling
 * directory convention: <bot-core-parent>/skills/
 */

import fs from "node:fs/promises";
import path from "node:path";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

// ── Types ─────────────────────────────────────────────────────────────────

export type ExpenseCategory = "equipment" | "software" | "marketing" | "operations" | "travel" | "other";
export type RiskLevel = "low" | "medium" | "high";

/** Typed output from the finance/expense_v1 skill. */
export type ExpenseClassification = {
	category: ExpenseCategory;
	is_business_expense: boolean;
	reimbursable: boolean;
	risk_level: RiskLevel;
	suggestion: string;
	rationale: string;
};

export type ExpenseResult =
	| { ok: true; data: ExpenseClassification }
	| { ok: false; error: string };

// ── Constants ─────────────────────────────────────────────────────────────

const SKILL_RELATIVE_PATH = "finance/expense_v1/prompt.md";
const VALID_CATEGORIES = new Set(["equipment", "software", "marketing", "operations", "travel", "other"]);
const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);

// ── Skills directory resolution ──────────────────────────────────────────

function resolveSkillsDir(): string {
	if (process.env.AINETRIX_SKILLS_DIR) {
		return process.env.AINETRIX_SKILLS_DIR;
	}
	// Default: sibling to bot-core — e.g. /workspace/ainetrix/skills/
	// process.cwd() is typically the repo root when running tests or dev commands.
	return path.resolve(process.cwd(), "..", "skills");
}

// ── Prompt loading ────────────────────────────────────────────────────────

/** Load the skill system prompt from disk. Throws if file is not found. */
async function loadSystemPrompt(skillsDir: string): Promise<string> {
	const promptPath = path.join(skillsDir, SKILL_RELATIVE_PATH);
	try {
		return await fs.readFile(promptPath, "utf8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`finance/expense_v1 prompt.md not found at ${promptPath}. ` +
			`Set AINETRIX_SKILLS_DIR to the skills root directory. (${msg})`,
		);
	}
}

// ── Response validation ───────────────────────────────────────────────────

/** Validate that the AI output matches the ExpenseClassification schema. */
function validateClassification(data: unknown): ExpenseClassification {
	if (typeof data !== "object" || data === null) {
		throw new Error("Response is not a JSON object.");
	}
	const obj = data as Record<string, unknown>;

	if (!VALID_CATEGORIES.has(obj.category as string)) {
		throw new Error(`Invalid category: "${obj.category}". Must be one of: ${[...VALID_CATEGORIES].join(", ")}`);
	}
	if (typeof obj.is_business_expense !== "boolean") {
		throw new Error("is_business_expense must be a boolean.");
	}
	if (typeof obj.reimbursable !== "boolean") {
		throw new Error("reimbursable must be a boolean.");
	}
	if (!VALID_RISK_LEVELS.has(obj.risk_level as string)) {
		throw new Error(`Invalid risk_level: "${obj.risk_level}". Must be one of: ${[...VALID_RISK_LEVELS].join(", ")}`);
	}
	if (typeof obj.suggestion !== "string" || !obj.suggestion) {
		throw new Error("suggestion must be a non-empty string.");
	}
	if (typeof obj.rationale !== "string" || !obj.rationale) {
		throw new Error("rationale must be a non-empty string.");
	}

	return {
		category: obj.category as ExpenseCategory,
		is_business_expense: obj.is_business_expense,
		reimbursable: obj.reimbursable,
		risk_level: obj.risk_level as RiskLevel,
		suggestion: obj.suggestion,
		rationale: obj.rationale,
	};
}

// ── Main adapter ──────────────────────────────────────────────────────────

export type ExpenseAdapterOptions = {
	/** Override the skills directory (defaults to AINETRIX_SKILLS_DIR or ../skills). */
	skillsDir?: string;
	/** OpenRouter API key. Defaults to OPENROUTER_API_KEY env var. */
	apiKey?: string;
	/** Model slug. Defaults to anthropic/claude-haiku-4-5 (via OpenRouter). */
	model?: string;
};

/**
 * Classify an expense description using the finance/expense_v1 skill.
 *
 * @param message - Natural-language expense description from the user
 * @param options - Optional overrides for skills dir, API key, model
 */
export async function classifyExpense(
	message: string,
	options: ExpenseAdapterOptions = {},
): Promise<ExpenseResult> {
	const skillsDir = options.skillsDir ?? resolveSkillsDir();
	const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;

	// 1. Load prompt
	let systemPrompt: string;
	try {
		systemPrompt = await loadSystemPrompt(skillsDir);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	if (!apiKey) {
		return { ok: false, error: "No API key available. Set OPENROUTER_API_KEY or pass options.apiKey." };
	}

	// 2. Call AI
	let rawText: string;
	try {
		const model = getModel("openrouter", "anthropic/claude-haiku-4-5");
		const context = {
			systemPrompt,
			messages: [
				{ role: "user" as const, content: message, timestamp: Date.now() },
			],
		};
		const result = await completeSimple(model, context, { apiKey });
		// Extract text from the first text content block
		const textBlock = result.content.find((c) => c.type === "text");
		if (!textBlock || textBlock.type !== "text") {
			return { ok: false, error: "AI returned no text content." };
		}
		rawText = textBlock.text;
	} catch (err) {
		return { ok: false, error: `AI call failed: ${err instanceof Error ? err.message : String(err)}` };
	}

	// 3. Parse JSON
	let parsed: unknown;
	try {
		// Strip markdown code fences if the model emits them despite instructions
		const cleaned = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
		parsed = JSON.parse(cleaned);
	} catch {
		return { ok: false, error: `AI response is not valid JSON. Raw: ${rawText.slice(0, 200)}` };
	}

	// 4. Validate structure
	try {
		const classification = validateClassification(parsed);
		return { ok: true, data: classification };
	} catch (err) {
		return { ok: false, error: `Schema validation failed: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/**
 * Format an ExpenseClassification into a user-readable reply.
 */
export function formatExpenseResult(classification: ExpenseClassification): string {
	const riskEmoji = classification.risk_level === "low" ? "✅" : classification.risk_level === "medium" ? "⚠️" : "❌";
	const lines = [
		`**Category:** ${classification.category}`,
		`**Business expense:** ${classification.is_business_expense ? "Yes" : "No"}`,
		`**Reimbursable:** ${classification.reimbursable ? "Yes" : "No"}`,
		`**Risk level:** ${riskEmoji} ${classification.risk_level}`,
		``,
		`**Suggestion:** ${classification.suggestion}`,
		`**Rationale:** ${classification.rationale}`,
	];
	return lines.join("\n");
}
