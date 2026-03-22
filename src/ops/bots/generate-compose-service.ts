/**
 * Pure generator: BotSpec → docker-compose service fragment.
 *
 * Produces a plain object representing one `services.<bot-id>:` block.
 * The caller assembles multiple fragments into a full compose file.
 *
 * Stage 7B scope: generation only, no docker execution or file I/O.
 */

import type { BotSpec } from "./bot-spec.js";
import { generateEnv, type GenerateEnvOptions } from "./generate-env.js";

/** Default gateway port when none specified. */
const DEFAULT_GATEWAY_PORT = 18789;

/** Default Docker image for bot containers. */
const DEFAULT_IMAGE = "openclaw-dev:latest";

export type GenerateComposeOptions = GenerateEnvOptions & {
	/** Docker image to use. Defaults to "openclaw-dev:latest". */
	image?: string;

	/** Host directory for openclaw config (maps to /home/node/.openclaw). */
	configDir?: string;

	/** Host directory for workspace (maps to /home/node/.openclaw/workspace). */
	workspaceDir?: string;
};

/**
 * Compose service fragment — a plain object that can be serialized to YAML
 * under `services.<bot-id>:` in a docker-compose file.
 */
export type ComposeServiceFragment = {
	image: string;
	container_name: string;
	environment: Record<string, string>;
	ports: string[];
	entrypoint: string[];
	command: string[];
	volumes: string[];
	init: boolean;
	restart: string;
	healthcheck: {
		test: string[];
		interval: string;
		timeout: string;
		retries: number;
		start_period: string;
	};
};

/**
 * Generate a docker-compose service definition for a single bot.
 *
 * Mirrors the structure of the existing `openclaw-gateway` service in docker-compose.yml
 * but parameterized per-bot via BotSpec.
 */
export function generateComposeService(spec: BotSpec, options: GenerateComposeOptions = {}): ComposeServiceFragment {
	const port = spec.gatewayPort ?? options.defaultPort ?? DEFAULT_GATEWAY_PORT;
	const image = options.image ?? DEFAULT_IMAGE;
	const env = generateEnv(spec, options);

	const volumes: string[] = [];
	if (options.configDir) {
		volumes.push(`${options.configDir}/${spec.id}:/home/node/.openclaw`);
	}
	if (options.workspaceDir) {
		volumes.push(`${options.workspaceDir}/${spec.id}:/home/node/.openclaw/workspace`);
	}

	return {
		image,
		container_name: `openclaw-${spec.id}`,
		environment: env,
		ports: [`${port}:${port}`],
		entrypoint: ["node", "/app/openclaw.mjs"],
		command: ["gateway", "run", "--dev", "--bind", "lan", "--port", String(port), "--allow-unconfigured"],
		volumes,
		init: true,
		restart: "unless-stopped",
		healthcheck: {
			test: [
				"CMD",
				"node",
				"-e",
				`fetch('http://127.0.0.1:${port}/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
			],
			interval: "30s",
			timeout: "5s",
			retries: 5,
			start_period: "20s",
		},
	};
}
