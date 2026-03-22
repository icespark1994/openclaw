/**
 * Load a BotSpec from a YAML file.
 */

import fs from "node:fs/promises";
import YAML from "yaml";
import { BotSpecV1 } from "./bot-spec.js";
import type { BotSpec } from "./bot-spec.js";

/**
 * Read and parse a bot spec YAML file.
 *
 * @param filePath — absolute or relative path to a `.yaml` / `.yml` file
 * @returns parsed and validated BotSpec
 * @throws on file read error, YAML parse error, or schema validation failure
 */
export async function loadBotSpec(filePath: string): Promise<BotSpec> {
	const raw = await fs.readFile(filePath, "utf-8");
	const data: unknown = YAML.parse(raw);
	return BotSpecV1.parse(data);
}
