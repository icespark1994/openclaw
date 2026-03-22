/**
 * Bot Lifecycle Executor — runs docker compose commands against a LifecyclePlan.
 *
 * Converts a plan into a temporary compose file, then shells out to
 * `docker compose` for start/stop/restart/status.
 *
 * The shell command runner is injectable (`CommandExecutor`) so tests can
 * verify the correct commands without a real Docker daemon.
 *
 * Stage 7C.3 scope: execution adapter only.  No CLI, no control bot workflow.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import YAML from "yaml";
import type { LifecyclePlan } from "./lifecycle-plan.js";

// ── Types ────────────────────────────────────────────────────────────

export type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/** Injectable shell command runner.  Default uses child_process.execFile. */
export type CommandExecutor = (cmd: string, args: string[]) => Promise<CommandResult>;

export type BotStatus = {
	botId: string;
	containerName: string;
	running: boolean;
	/** Raw status string from docker (e.g. "Up 3 minutes", "Exited (0) 5 minutes ago"). */
	status: string;
};

export type ExecutorOptions = {
	/** Override the command runner (for testing). */
	exec?: CommandExecutor;
	/**
	 * Directory for generated compose files.
	 * Defaults to a temp directory.  Caller may set a persistent path
	 * so files survive across restarts for `docker compose down`.
	 */
	composeDir?: string;
};

// ── Default executor ─────────────────────────────────────────────────

const EXEC_TIMEOUT_MS = 60_000;

export const defaultExec: CommandExecutor = (cmd, args) =>
	new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err && !("code" in err && typeof err.code === "number")) {
				reject(err);
				return;
			}
			const exitCode = err && "code" in err && typeof err.code === "number" ? err.code : 0;
			resolve({ exitCode, stdout, stderr });
		});
	});

// ── Compose file generation ──────────────────────────────────────────

/** Build a full compose document from a plan's service fragment. */
function buildComposeDoc(plan: LifecyclePlan): Record<string, unknown> {
	return {
		services: {
			[plan.botId]: plan.composeService,
		},
	};
}

/**
 * Write a temporary compose file for a plan.
 * Returns the absolute path to the generated file.
 */
async function writeComposeFile(plan: LifecyclePlan, dir?: string): Promise<string> {
	const composeDir = dir ?? path.join(os.tmpdir(), "openclaw-bots");
	await fs.mkdir(composeDir, { recursive: true });
	const filePath = path.join(composeDir, `docker-compose.${plan.botId}.yml`);
	const doc = buildComposeDoc(plan);
	await fs.writeFile(filePath, YAML.stringify(doc), "utf-8");
	return filePath;
}

// ── Lifecycle operations ─────────────────────────────────────────────

/**
 * Start a bot container from its lifecycle plan.
 *
 * Writes a compose file, then runs `docker compose -f <file> up -d`.
 */
export async function startBot(plan: LifecyclePlan, options: ExecutorOptions = {}): Promise<CommandResult> {
	const exec = options.exec ?? defaultExec;
	const composePath = await writeComposeFile(plan, options.composeDir);
	return exec("docker", ["compose", "-f", composePath, "up", "-d"]);
}

/**
 * Stop a bot container.
 *
 * Runs `docker compose -f <file> down` to stop and remove the container.
 */
export async function stopBot(plan: LifecyclePlan, options: ExecutorOptions = {}): Promise<CommandResult> {
	const exec = options.exec ?? defaultExec;
	const composePath = await writeComposeFile(plan, options.composeDir);
	return exec("docker", ["compose", "-f", composePath, "down"]);
}

/**
 * Restart a bot: stop then start.
 */
export async function restartBot(plan: LifecyclePlan, options: ExecutorOptions = {}): Promise<CommandResult> {
	const stopResult = await stopBot(plan, options);
	if (stopResult.exitCode !== 0) return stopResult;
	return startBot(plan, options);
}

/**
 * Query the running status of a bot's container.
 *
 * Uses `docker inspect` on the container name from the plan.
 * Does not require a compose file.
 */
export async function statusBot(plan: LifecyclePlan, options: ExecutorOptions = {}): Promise<BotStatus> {
	const exec = options.exec ?? defaultExec;
	const containerName = plan.composeService.container_name;

	const result = await exec("docker", [
		"inspect",
		"--format",
		"{{.State.Running}}|{{.State.Status}}",
		containerName,
	]);

	// Container not found
	if (result.exitCode !== 0) {
		return {
			botId: plan.botId,
			containerName,
			running: false,
			status: "not found",
		};
	}

	const output = result.stdout.trim();
	const [runningStr, status] = output.split("|");

	return {
		botId: plan.botId,
		containerName,
		running: runningStr === "true",
		status: status || "unknown",
	};
}

// Exported for testing
export { buildComposeDoc, writeComposeFile };
