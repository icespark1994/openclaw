/**
 * Serialize and write a BotSpec to a YAML file.
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { BotSpecV1 } from "./bot-spec.js";
import type { BotSpec } from "./bot-spec.js";

/**
 * Validate a BotSpec and write it as YAML.
 *
 * Creates parent directories if they don't exist.
 *
 * @param filePath — destination path (`.yaml` / `.yml`)
 * @param spec — the bot spec object (validated before writing)
 */
export async function writeBotSpec(filePath: string, spec: BotSpec): Promise<void> {
	// Validate before writing to catch bad data early
	const validated = BotSpecV1.parse(spec);

	const content = YAML.stringify(validated, {
		lineWidth: 120,
		defaultKeyType: "PLAIN",
		defaultStringType: "PLAIN",
	});

	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf-8");
}
