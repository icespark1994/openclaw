/**
 * Bot Manager — service layer that composes registry, planner, and executor
 * into a cohesive bot management API.
 *
 * All dependencies are injected via BotManagerConfig so the manager is
 * fully testable without a real filesystem or Docker daemon.
 *
 * Stage 7D scope: orchestrator core.  No CLI, no control bot workflow.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BotSpec } from "./bot-spec.js";
import type { CommandResult, BotStatus, ExecutorOptions } from "./executor.js";
import { startBot, stopBot, restartBot, statusBot } from "./executor.js";
import { getInProcessBot, listInProcessBots, type InProcessBot } from "./in-process-registry.js";
import type { LifecyclePlan, PlanOptions } from "./lifecycle-plan.js";
import { planBotLifecycle } from "./lifecycle-plan.js";
import { loadBotRegistry, getBotSpecById } from "./registry.js";
import { writeBotSpec } from "./write-bot-spec.js";

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

// ── In-process helpers ───────────────────────────────────────────────

/** Convert an in-process bot's live state to the BotStatus shape. */
function inProcessBotStatus(bot: InProcessBot): BotStatus {
  return {
    botId: bot.id,
    containerName: bot.id, // virtual — no real container
    running: bot.getStatus() === "running",
    status: bot.getStatus(),
  };
}

/**
 * Build a minimal BotSpec from an InProcessBot for use in list output.
 * The `model.id` value "in-process" signals to callers that no container exists.
 */
function makeSpecFromInProcessBot(bot: InProcessBot): BotSpec {
  return {
    version: 1 as const,
    id: bot.id,
    name: bot.name,
    model: { id: "in-process" },
    skills: [...bot.skills],
    env: {},
    enabled: true,
  };
}

// ── Manager ──────────────────────────────────────────────────────────

export class BotManager {
  private readonly config: BotManagerConfig;

  constructor(config: BotManagerConfig) {
    this.config = config;
  }

  /**
   * Deploy a bot: persist its spec, generate a plan, and start the container.
   *
   * 1. Validate prerequisites (token file exists for docker bots with telegram config)
   * 2. Write spec to specDir/<id>.yaml
   * 3. Generate LifecyclePlan
   * 4. Write openclaw.json to configDir/<id>/ (docker bots only; skips if file already exists)
   * 5. startBot(plan)
   */
  async deployBot(spec: BotSpec): Promise<DeployResult> {
    // Validate Telegram token file exists before touching docker
    if ((spec.runtime ?? "docker") === "docker" && spec.telegram?.tokenFile) {
      const resolved = spec.telegram.tokenFile.replace(/^~(?=$|\/)/, os.homedir());
      try {
        await fs.access(resolved);
      } catch {
        throw new Error(
          `Telegram token file not found: ${resolved}\n` +
            `Create it before deploying:\n` +
            `  echo "YOUR_BOT_TOKEN" > ${resolved}\n` +
            `  chmod 600 ${resolved}`,
        );
      }
    }

    const specPath = path.join(this.config.specDir, `${spec.id}.yaml`);
    await writeBotSpec(specPath, spec);

    const plan = planBotLifecycle(spec, this.config.planOptions);

    // Write openclaw.json for docker-runtime bots (first deploy only; skips if file exists)
    if (plan.runtime === "docker" && plan.botConfig !== null) {
      await this.writeBotContainerConfig(spec.id, plan.botConfig);
    }

    const startResult = await startBot(plan, this.config.executorOptions);

    return {
      ok: startResult.exitCode === 0,
      botId: spec.id,
      plan,
      startResult,
    };
  }

  /**
   * Write openclaw.json into the bot's config directory.
   * Skips silently if the file already exists (preserves user customisations on re-deploy).
   */
  private async writeBotContainerConfig(
    botId: string,
    botConfig: NonNullable<import("./lifecycle-plan.js").LifecyclePlan["botConfig"]>,
  ): Promise<void> {
    const configDir = this.config.planOptions?.configDir;
    if (!configDir) {
      return;
    }

    const botConfigDir = path.join(configDir, botId);
    await fs.mkdir(botConfigDir, { recursive: true });

    const configPath = path.join(botConfigDir, "openclaw.json");
    try {
      await fs.access(configPath);
      // File already exists — skip to preserve any user customisations
    } catch {
      await fs.writeFile(configPath, JSON.stringify(botConfig, null, 2), "utf-8");
    }
  }

  /**
   * Stop a bot by ID.
   * Checks the in-process registry first; falls back to docker for YAML-defined bots.
   */
  async stopBotById(id: string): Promise<StopResult> {
    const ipBot = getInProcessBot(id);
    if (ipBot) {
      ipBot.stop();
      return { ok: true, botId: id, stopResult: { exitCode: 0, stdout: "stopped", stderr: "" } };
    }

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
   * Restart a bot by ID.
   * Checks the in-process registry first; falls back to docker for YAML-defined bots.
   */
  async restartBotById(id: string): Promise<RestartResult> {
    const ipBot = getInProcessBot(id);
    if (ipBot) {
      ipBot.restart();
      return {
        ok: true,
        botId: id,
        restartResult: { exitCode: 0, stdout: "restarted", stderr: "" },
      };
    }

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
   * Checks the in-process registry first; falls back to docker inspect.
   */
  async getBotStatus(id: string): Promise<BotStatus> {
    const ipBot = getInProcessBot(id);
    if (ipBot) {
      return inProcessBotStatus(ipBot);
    }

    const spec = await this.resolveSpec(id);
    const plan = planBotLifecycle(spec, this.config.planOptions);
    return statusBot(plan, this.config.executorOptions);
  }

  /**
   * List all registered bots with their running status.
   * Includes YAML-defined bots (docker) and in-process bots (combined, deduped by id).
   */
  async listBots(): Promise<{ spec: BotSpec; status: BotStatus }[]> {
    const { specs } = await loadBotRegistry(this.config.specDir);
    const results: { spec: BotSpec; status: BotStatus }[] = [];
    const yamlIds = new Set<string>();

    for (const spec of specs) {
      yamlIds.add(spec.id);
      // If a YAML-defined bot is also registered in-process, use the live status.
      const ipBot = getInProcessBot(spec.id);
      if (ipBot) {
        results.push({ spec, status: inProcessBotStatus(ipBot) });
      } else {
        const plan = planBotLifecycle(spec, this.config.planOptions);
        const status = await statusBot(plan, this.config.executorOptions);
        results.push({ spec, status });
      }
    }

    // Include in-process bots that have no YAML spec (e.g. built-in bots).
    for (const ipBot of listInProcessBots()) {
      if (yamlIds.has(ipBot.id)) {
        continue;
      }
      results.push({
        spec: makeSpecFromInProcessBot(ipBot),
        status: inProcessBotStatus(ipBot),
      });
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
