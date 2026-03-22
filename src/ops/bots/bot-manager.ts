/**
 * Bot Manager — service layer that composes registry, planner, and executor
 * into a cohesive bot management API.
 *
 * All dependencies are injected via BotManagerConfig so the manager is
 * fully testable without a real filesystem or Docker daemon.
 *
 * Stage 7D scope: orchestrator core.  No CLI, no control bot workflow.
 */

import path from "node:path";
import type { BotSpec } from "./bot-spec.js";
import type { LifecyclePlan, PlanOptions } from "./lifecycle-plan.js";
import type { CommandResult, BotStatus, ExecutorOptions } from "./executor.js";
import { loadBotRegistry, getBotSpecById } from "./registry.js";
import { writeBotSpec } from "./write-bot-spec.js";
import { planBotLifecycle } from "./lifecycle-plan.js";
import { startBot, stopBot, restartBot, statusBot } from "./executor.js";

// ── Config ───────────────────────────────────────────────────────────

export type BotManagerConfig = {
	/** Directory where bot spec YAML files are stored. */
	specDir: string;
	/** Options forwarded to planBotLifecycle (image, configDir, etc.). */
	planOptions?: PlanOptions;
	/** Options forwarded to executor functions (exec override, composeDir). */
	executorOptions?: ExecutorOptions;
};

// ── Result types ─────────────────────────────────────────────────────

export type DeployResult = {
	ok: boolean;
	botId: string;
	plan: LifecyclePlan;
	startResult: CommandResult;
};

export type StopResult = {
	ok: boolean;
	botId: string;
	stopResult: CommandResult;
};

export type RestartResult = {
	ok: boolean;
	botId: string;
	restartResult: CommandResult;
};

// ── Manager ──────────────────────────────────────────────────────────

export class BotManager {
	private readonly config: BotManagerConfig;

	constructor(config: BotManagerConfig) {
		this.config = config;
	}

	/**
	 * Deploy a bot: persist its spec, generate a plan, and start the container.
	 *
	 * 1. Write spec to specDir/<id>.yaml
	 * 2. Generate LifecyclePlan
	 * 3. startBot(plan)
	 */
	async deployBot(spec: BotSpec): Promise<DeployResult> {
		const specPath = path.join(this.config.specDir, `${spec.id}.yaml`);
		await writeBotSpec(specPath, spec);

		const plan = planBotLifecycle(spec, this.config.planOptions);
		const startResult = await startBot(plan, this.config.executorOptions);

		return {
			ok: startResult.exitCode === 0,
			botId: spec.id,
			plan,
			startResult,
		};
	}

	/**
	 * Stop a bot by ID: load from registry, plan, and stop.
	 */
	async stopBotById(id: string): Promise<StopResult> {
		const spec = await this.resolveSpec(id);
		const plan = planBotLifecycle(spec, this.config.planOptions);
		const stopResult = await stopBot(plan, this.config.executorOptions);

		return {
			ok: stopResult.exitCode === 0,
			botId: id,
			stopResult,
		};
	}

	/**
	 * Restart a bot by ID: load from registry, plan, stop then start.
	 */
	async restartBotById(id: string): Promise<RestartResult> {
		const spec = await this.resolveSpec(id);
		const plan = planBotLifecycle(spec, this.config.planOptions);
		const restartResult = await restartBot(plan, this.config.executorOptions);

		return {
			ok: restartResult.exitCode === 0,
			botId: id,
			restartResult,
		};
	}

	/**
	 * Get the status of a bot by ID.
	 */
	async getBotStatus(id: string): Promise<BotStatus> {
		const spec = await this.resolveSpec(id);
		const plan = planBotLifecycle(spec, this.config.planOptions);
		return statusBot(plan, this.config.executorOptions);
	}

	/**
	 * List all registered bots with their running status.
	 */
	async listBots(): Promise<{ spec: BotSpec; status: BotStatus }[]> {
		const { specs } = await loadBotRegistry(this.config.specDir);
		const results: { spec: BotSpec; status: BotStatus }[] = [];

		for (const spec of specs) {
			const plan = planBotLifecycle(spec, this.config.planOptions);
			const status = await statusBot(plan, this.config.executorOptions);
			results.push({ spec, status });
		}

		return results;
	}

	// ── Internal ─────────────────────────────────────────────────────

	private async resolveSpec(id: string): Promise<BotSpec> {
		const { specs } = await loadBotRegistry(this.config.specDir);
		const spec = getBotSpecById(specs, id);
		if (!spec) {
			throw new Error(`bot not found: "${id}"`);
		}
		return spec;
	}
}
