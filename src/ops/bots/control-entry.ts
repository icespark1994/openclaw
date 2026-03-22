/**
 * Control Entry — parses half-structured chat commands and dispatches
 * them to ControlService.
 *
 * This is the thinnest possible "chat → service" adapter:
 *   1. Match a /bot-* command prefix
 *   2. Extract arguments
 *   3. Call the corresponding ControlService method
 *   4. Return the response message string
 *
 * Stage 8B scope: command parsing + dispatch.  No NLP, no Telegram SDK,
 * no permission checks, no gateway changes.
 */

import { ControlService } from "./control-service.js";
import type { BotManagerConfig } from "./bot-manager.js";
import type { ControlResponse } from "./control-service.js";
import { queryAuditEntries, formatAuditEntries } from "./audit.js";
import { generateBotDraft } from "./draft-service.js";

const HELP_TEXT = [
	"Bot commands:",
	"  /bot-list              — list all registered bots",
	"  /bot-status <id>       — check if a bot is running",
	"  /bot-stop <id>         — stop a bot",
	"  /bot-restart <id>      — restart a bot",
	"  /bot-deploy <yaml>     — deploy a bot from inline YAML",
	"  /bot-audit [N|botId]   — show recent audit log",
	"  /bot-draft <desc>      — generate a bot spec draft",
	"  /bot-draft-deploy <desc> — draft + confirm flow",
	"  /bot-confirm           — deploy pending draft",
	"  /bot-cancel            — discard pending draft",
	"  /bot-help              — show this help",
].join("\n");

/** Parsed command from user input. */
type ParsedCommand =
	| { cmd: "list" }
	| { cmd: "status"; id: string }
	| { cmd: "stop"; id: string }
	| { cmd: "restart"; id: string }
	| { cmd: "deploy"; yaml: string }
	| { cmd: "audit"; arg?: string }
	| { cmd: "draft"; text: string }
	| { cmd: "draft-deploy"; text: string }
	| { cmd: "confirm" }
	| { cmd: "cancel" }
	| { cmd: "help" }
	| { cmd: "unknown"; input: string };

/**
 * Parse a raw chat message into a command.
 * Exported for direct testing of parse logic.
 */
export function parseCommand(input: string): ParsedCommand {
	const trimmed = input.trim();

	if (!trimmed.startsWith("/bot-")) {
		return { cmd: "unknown", input: trimmed };
	}

	// Split at first whitespace to get command and rest
	const spaceIdx = trimmed.indexOf(" ");
	const command = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

	switch (command) {
		case "/bot-list":
			return { cmd: "list" };

		case "/bot-status":
			return rest ? { cmd: "status", id: rest.split(/\s/)[0] } : { cmd: "unknown", input: trimmed };

		case "/bot-stop":
			return rest ? { cmd: "stop", id: rest.split(/\s/)[0] } : { cmd: "unknown", input: trimmed };

		case "/bot-restart":
			return rest ? { cmd: "restart", id: rest.split(/\s/)[0] } : { cmd: "unknown", input: trimmed };

		case "/bot-deploy":
			return rest ? { cmd: "deploy", yaml: rest } : { cmd: "unknown", input: trimmed };

		case "/bot-audit":
			return { cmd: "audit", arg: rest ? rest.split(/\s/)[0] : undefined };

		case "/bot-draft":
			return rest ? { cmd: "draft", text: rest } : { cmd: "unknown", input: trimmed };

		case "/bot-draft-deploy":
			return rest ? { cmd: "draft-deploy", text: rest } : { cmd: "unknown", input: trimmed };

		case "/bot-confirm":
			return { cmd: "confirm" };

		case "/bot-cancel":
			return { cmd: "cancel" };

		case "/bot-help":
			return { cmd: "help" };

		default:
			return { cmd: "unknown", input: trimmed };
	}
}

/**
 * Handle a raw chat message: parse, dispatch to ControlService, return reply text.
 *
 * Returns null if the message is not a /bot-* command (so the caller
 * can decide whether to pass it to other handlers).
 */
export async function handleBotCommand(
	input: string,
	service: ControlService,
): Promise<string | null> {
	const trimmed = input.trim();
	if (!trimmed.startsWith("/bot-")) return null;

	const parsed = parseCommand(trimmed);
	let response: ControlResponse;

	switch (parsed.cmd) {
		case "list":
			response = await service.listBots();
			return response.message;

		case "status":
			response = await service.statusById(parsed.id);
			return response.message;

		case "stop":
			response = await service.stopById(parsed.id);
			return response.message;

		case "restart":
			response = await service.restartById(parsed.id);
			return response.message;

		case "deploy":
			response = await service.deployFromYaml(parsed.yaml);
			return response.message;

		case "draft": {
			const draft = generateBotDraft(parsed.text);
			return draft.message;
		}

		case "audit": {
			const arg = parsed.arg;
			// If arg is a number, use as limit; otherwise treat as botId filter
			const isNum = arg && /^\d+$/.test(arg);
			const query = isNum
				? { limit: Number(arg) }
				: arg ? { botId: arg } : {};
			const entries = await queryAuditEntries(query);
			return formatAuditEntries(entries, query);
		}

		case "help":
			return HELP_TEXT;

		case "unknown":
			return missingArgMessage(parsed.input);

		// draft-deploy / confirm / cancel are handled upstream in commands-bot.ts
		case "draft-deploy":
		case "confirm":
		case "cancel":
			return null;
	}
}

/** Generate a helpful error for unrecognized or incomplete commands. */
function missingArgMessage(input: string): string {
	if (input.startsWith("/bot-status")) return "Usage: /bot-status <id>";
	if (input.startsWith("/bot-stop")) return "Usage: /bot-stop <id>";
	if (input.startsWith("/bot-restart")) return "Usage: /bot-restart <id>";
	if (input.startsWith("/bot-deploy")) return "Usage: /bot-deploy <yaml>";
	if (input.startsWith("/bot-draft-deploy")) return "Usage: /bot-draft-deploy <description>";
	if (input.startsWith("/bot-draft")) return "Usage: /bot-draft <description>";
	return `Unknown command: "${input}"\n${HELP_TEXT}`;
}

/**
 * Create a standalone handler function with a pre-configured service.
 * Convenience for wiring into a message handler.
 */
export function createBotCommandHandler(config: BotManagerConfig): (input: string) => Promise<string | null> {
	const service = new ControlService(config);
	return (input) => handleBotCommand(input, service);
}
