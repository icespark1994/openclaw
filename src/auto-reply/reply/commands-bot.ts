/**
 * Command handler for /bot-* commands — wires into the existing
 * command handler chain to dispatch bot orchestrator actions.
 *
 * Stage 8C.1: adds authorization check + audit logging before dispatch.
 */

import os from "node:os";
import path from "node:path";
import { logVerbose } from "../../globals.js";
import { parseCommand, handleBotCommand } from "../../ops/bots/control-entry.js";
import { ControlService } from "../../ops/bots/control-service.js";
import {
	checkBotCommandPermission,
	resolveUserRole,
	buildDenialMessage,
	emitAuditLog,
	type BotAction,
} from "../../ops/bots/auth.js";
import { generateBotDraft } from "../../ops/bots/draft-service.js";
import { setPendingDraft, getPendingDraft, clearPendingDraft } from "../../ops/bots/pending-drafts.js";
import type { CommandHandler } from "./commands-types.js";

/**
 * Resolve the bot spec directory.
 * Convention: ~/.openclaw/bots/  (or OPENCLAW_BOTS_DIR override).
 */
function resolveBotsDir(): string {
	return process.env.OPENCLAW_BOTS_DIR ?? path.join(os.homedir(), ".openclaw", "bots");
}

/** Lazily created ControlService singleton (one per process). */
let cachedService: ControlService | null = null;

function getControlService(): ControlService {
	if (!cachedService) {
		const specDir = resolveBotsDir();
		cachedService = new ControlService({
			specDir,
			planOptions: {
				configDir: path.join(path.dirname(specDir), "bot-config"),
			},
			executorOptions: {
				composeDir: path.join(path.dirname(specDir), "bot-compose"),
			},
		});
	}
	return cachedService;
}

/** Reset the cached service (for testing). */
export function resetControlServiceCache(): void {
	cachedService = null;
}

/** Map parsed command type to BotAction for auth check. */
function commandToAction(cmd: string): BotAction | null {
	switch (cmd) {
		case "deploy": case "stop": case "restart":
		case "list": case "status": case "help": case "audit": case "draft":
		case "draft-deploy": case "confirm": case "cancel":
			return cmd as BotAction;
		default:
			// "unknown" commands still need at least viewer to see error/help
			return "help";
	}
}

/** Extract target bot ID from a parsed command (for audit). */
function extractTargetBotId(input: string): string | undefined {
	const parsed = parseCommand(input);
	if ("id" in parsed) return parsed.id;
	return undefined;
}

export const handleBotCommands: CommandHandler = async (params, allowTextCommands) => {
	if (!allowTextCommands) {
		return null;
	}

	const commandBody = params.command.commandBodyNormalized;
	if (!commandBody.startsWith("/bot-")) {
		return null;
	}

	if (!params.command.isAuthorizedSender) {
		logVerbose(
			`Ignoring /bot- command from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
		);
		return { shouldContinue: false };
	}

	const userId = params.command.senderId ?? "unknown";
	const parsed = parseCommand(commandBody);
	const action = commandToAction(parsed.cmd);

	// Authorization check
	if (action && !checkBotCommandPermission(userId, action)) {
		const role = resolveUserRole(userId);
		const denial = buildDenialMessage(action, role);

		emitAuditLog({
			timestamp: new Date().toISOString(),
			userId,
			command: commandBody,
			targetBotId: extractTargetBotId(commandBody),
			result: "denied",
		});

		return {
			shouldContinue: false,
			reply: { text: denial },
		};
	}

	// Handle draft-deploy / confirm / cancel (need userId for pending cache)
	if (parsed.cmd === "draft-deploy" && "text" in parsed) {
		const draft = generateBotDraft(parsed.text);
		if (!draft.ok) {
			return { shouldContinue: false, reply: { text: draft.message } };
		}
		// Extract YAML from the draft message (between ```yaml and ```)
		const yamlMatch = draft.message.match(/```yaml\n([\s\S]+?)```/);
		const yaml = yamlMatch?.[1]?.trim() ?? "";
		// Extract bot id from the YAML
		const idMatch = yaml.match(/^id:\s*(.+)$/m);
		const botId = idMatch?.[1]?.trim() ?? "unknown";

		setPendingDraft(userId, { yaml, botId, createdAt: new Date().toISOString() });

		emitAuditLog({ timestamp: new Date().toISOString(), userId, command: commandBody, targetBotId: botId, result: "success" });

		const reply = [
			draft.message.replace(
				"Review this draft, then run /bot-deploy <yaml> to deploy.",
				"Reply /bot-confirm to deploy, or /bot-cancel to discard.",
			),
		].join("\n");
		return { shouldContinue: false, reply: { text: reply } };
	}

	if (parsed.cmd === "confirm") {
		const pending = getPendingDraft(userId);
		if (!pending) {
			return { shouldContinue: false, reply: { text: "No pending draft. Use /bot-draft-deploy <desc> first." } };
		}
		clearPendingDraft(userId);
		const service = getControlService();
		const response = await service.deployFromYaml(pending.yaml);
		emitAuditLog({ timestamp: new Date().toISOString(), userId, command: "/bot-confirm", targetBotId: pending.botId, result: response.ok ? "success" : "error" });
		return { shouldContinue: false, reply: { text: response.message } };
	}

	if (parsed.cmd === "cancel") {
		const had = clearPendingDraft(userId);
		const msg = had ? "Draft discarded." : "No pending draft to cancel.";
		emitAuditLog({ timestamp: new Date().toISOString(), userId, command: "/bot-cancel", result: "success" });
		return { shouldContinue: false, reply: { text: msg } };
	}

	// Dispatch all other commands via control-entry
	const service = getControlService();
	const reply = await handleBotCommand(commandBody, service);

	if (reply === null) {
		return null;
	}

	emitAuditLog({
		timestamp: new Date().toISOString(),
		userId,
		command: commandBody,
		targetBotId: extractTargetBotId(commandBody),
		result: "success",
	});

	return {
		shouldContinue: false,
		reply: { text: reply },
	};
};
