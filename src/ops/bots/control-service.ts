/**
 * Control Service — thin façade over BotManager that produces
 * user-readable responses suitable for a Control Bot to relay.
 *
 * Each method returns a ControlResponse: { ok, message } where
 * `message` is a short string ready to send to the user.
 *
 * Stage 8A scope: service layer only.  No natural-language parsing,
 * no Telegram/Discord wiring, no gateway changes.
 */

import YAML from "yaml";
import { BotSpecV1 } from "./bot-spec.js";
import { BotManager, type BotManagerConfig } from "./bot-manager.js";
import { loadBotRegistry, getBotSpecById } from "./registry.js";
import { checkDeployGuards } from "./deploy-guard.js";
import { dispatchSkill, registeredSkillIds } from "../expense/skill-dispatch.js";

// ── Types ────────────────────────────────────────────────────────────

export type ControlResponse = {
	ok: boolean;
	message: string;
};

// ── Service ──────────────────────────────────────────────────────────

export class ControlService {
	private readonly manager: BotManager;
	private readonly specDir: string;

	constructor(config: BotManagerConfig) {
		this.manager = new BotManager(config);
		this.specDir = config.specDir;
	}

	/**
	 * Deploy a bot from raw YAML text.
	 *
	 * Parses → validates → deploys → returns readable result.
	 */
	async deployFromYaml(yamlText: string): Promise<ControlResponse> {
		// Parse YAML
		let data: unknown;
		try {
			data = YAML.parse(yamlText);
		} catch {
			return { ok: false, message: "Invalid YAML syntax." };
		}

		// Validate against BotSpec schema
		const parsed = BotSpecV1.safeParse(data);
		if (!parsed.success) {
			const firstIssue = parsed.error.issues[0];
			const detail = firstIssue
				? `${firstIssue.path.join(".")}: ${firstIssue.message}`
				: "unknown validation error";
			return { ok: false, message: `Invalid bot spec: ${detail}` };
		}

		const spec = parsed.data;

		if (!spec.enabled) {
			return { ok: false, message: `Bot "${spec.id}" is disabled (enabled: false).` };
		}

		// Deploy guardrails — check for conflicts before touching docker
		try {
			const { specs: existingSpecs } = await loadBotRegistry(this.specDir);
			const guard = checkDeployGuards(spec, existingSpecs);
			if (!guard.ok) {
				return { ok: false, message: `Deploy blocked: ${guard.reason}` };
			}
		} catch {
			// Registry load failure is non-fatal — proceed with deploy
		}

		// Deploy
		try {
			const result = await this.manager.deployBot(spec);
			if (!result.ok) {
				return { ok: false, message: `Deploy failed for "${spec.id}": container start returned exit ${result.startResult.exitCode}.` };
			}
			return {
				ok: true,
				message: `Bot "${spec.id}" deployed (port ${spec.gatewayPort ?? "auto"}, model ${spec.model.id}).`,
			};
		} catch (err) {
			return { ok: false, message: `Deploy error: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	/**
	 * Restart a bot by ID.
	 */
	async restartById(id: string): Promise<ControlResponse> {
		try {
			const result = await this.manager.restartBotById(id);
			if (!result.ok) {
				return { ok: false, message: `Restart failed for "${id}": exit ${result.restartResult.exitCode}.` };
			}
			return { ok: true, message: `Bot "${id}" restarted.` };
		} catch (err) {
			return { ok: false, message: errMsg(err) };
		}
	}

	/**
	 * Stop a bot by ID.
	 */
	async stopById(id: string): Promise<ControlResponse> {
		try {
			const result = await this.manager.stopBotById(id);
			if (!result.ok) {
				return { ok: false, message: `Stop failed for "${id}": exit ${result.stopResult.exitCode}.` };
			}
			return { ok: true, message: `Bot "${id}" stopped.` };
		} catch (err) {
			return { ok: false, message: errMsg(err) };
		}
	}

	/**
	 * Get status of a bot by ID.
	 */
	async statusById(id: string): Promise<ControlResponse> {
		try {
			const status = await this.manager.getBotStatus(id);
			const state = status.running ? "running" : status.status;
			return {
				ok: true,
				message: `Bot "${id}": ${state} (container: ${status.containerName}).`,
			};
		} catch (err) {
			return { ok: false, message: errMsg(err) };
		}
	}

	/**
	 * Invoke a bot's skill with a user message.
	 *
	 * Looks up the bot by ID in the registry, finds the first skill that has
	 * a registered handler, and dispatches the message to that handler.
	 * The skill registry is the extensible dispatch layer — adding a new skill
	 * only requires registering a handler there, not modifying this method.
	 */
	async invokeBot(id: string, message: string): Promise<ControlResponse> {
		// 1. Look up the bot spec
		let spec;
		try {
			const { specs } = await loadBotRegistry(this.specDir);
			spec = getBotSpecById(specs, id);
		} catch {
			// Registry load failure — proceed to the not-found error below
		}

		if (!spec) {
			return {
				ok: false,
				message: `Bot "${id}" not found in registry. Deploy it first with /bot-deploy.`,
			};
		}

		// 2. Find the first skill that has a registered handler
		const { skills } = spec;
		if (!skills.length) {
			return { ok: false, message: `Bot "${id}" has no skills configured.` };
		}

		const known = new Set(registeredSkillIds());
		const skillId = skills.find((s) => known.has(s));
		if (!skillId) {
			return {
				ok: false,
				message: `No handler registered for any skill in bot "${id}" (skills: ${skills.join(", ")}).`,
			};
		}

		// 3. Dispatch and return the result
		const result = await dispatchSkill(skillId, message);
		return { ok: result.ok, message: result.output };
	}

	/**
	 * List all bots with status summary.
	 */
	async listBots(): Promise<ControlResponse> {
		try {
			const bots = await this.manager.listBots();
			if (bots.length === 0) {
				return { ok: true, message: "No bots registered." };
			}
			const lines = bots.map((b) => {
				const state = b.status.running ? "running" : b.status.status;
				return `- ${b.spec.id}: ${state} (model: ${b.spec.model.id})`;
			});
			return {
				ok: true,
				message: `${bots.length} bot(s):\n${lines.join("\n")}`,
			};
		} catch (err) {
			return { ok: false, message: errMsg(err) };
		}
	}
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
