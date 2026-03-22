/**
 * Bot Registry — loads, indexes, and queries bot specs from a directory.
 *
 * Responsibilities:
 *   - Scan a spec directory for *.yaml / *.yml files
 *   - Parse each into a validated BotSpec
 *   - Detect duplicate IDs (hard error)
 *   - Provide lookup / list helpers
 *
 * Stage 7C.1 scope: read-only registry.  No lifecycle, no deployment.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadBotSpec } from "./load-bot-spec.js";
import type { BotSpec } from "./bot-spec.js";

/** Result of loading a single spec file — either success or a per-file error. */
export type SpecLoadResult =
	| { ok: true; spec: BotSpec; file: string }
	| { ok: false; file: string; error: string };

/** Full registry load result. */
export type BotRegistryResult = {
	/** Successfully parsed specs (unique IDs guaranteed). */
	specs: BotSpec[];
	/** Per-file errors (parse failures, duplicate IDs, etc.). */
	errors: SpecLoadResult[];
};

/**
 * Load all bot specs from a directory.
 *
 * Scans `specDir` for `*.yaml` and `*.yml` files (non-recursive).
 * Each file is parsed independently; parse failures are collected in `errors`
 * rather than aborting the entire load.
 *
 * Duplicate IDs across files are treated as errors — the first-seen spec wins,
 * subsequent duplicates go to the errors list.
 */
export async function loadBotRegistry(specDir: string): Promise<BotRegistryResult> {
	let entries: string[];
	try {
		entries = await fs.readdir(specDir);
	} catch {
		return { specs: [], errors: [] };
	}

	const yamlFiles = entries
		.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
		.sort(); // deterministic order

	const specs: BotSpec[] = [];
	const errors: SpecLoadResult[] = [];
	const seenIds = new Map<string, string>(); // id → first file

	for (const file of yamlFiles) {
		const filePath = path.join(specDir, file);
		let spec: BotSpec;
		try {
			spec = await loadBotSpec(filePath);
		} catch (err) {
			errors.push({
				ok: false,
				file,
				error: err instanceof Error ? err.message : String(err),
			});
			continue;
		}

		const existing = seenIds.get(spec.id);
		if (existing) {
			errors.push({
				ok: false,
				file,
				error: `duplicate bot id "${spec.id}" (first seen in ${existing})`,
			});
			continue;
		}

		seenIds.set(spec.id, file);
		specs.push(spec);
	}

	return { specs, errors };
}

/**
 * Find a spec by ID.  Returns undefined if not found.
 * Pure function — operates on an already-loaded spec array.
 */
export function getBotSpecById(specs: readonly BotSpec[], id: string): BotSpec | undefined {
	return specs.find((s) => s.id === id);
}

/**
 * List specs, optionally filtered by enabled status.
 * Pure function — no I/O.
 */
export function listBotSpecs(
	specs: readonly BotSpec[],
	filter?: { enabled?: boolean },
): BotSpec[] {
	if (filter?.enabled !== undefined) {
		return specs.filter((s) => s.enabled === filter.enabled);
	}
	return [...specs];
}
