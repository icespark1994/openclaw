/**
 * Pure generator: BotSpec → environment variable map.
 *
 * Produces a flat Record<string, string> suitable for docker-compose `environment:`
 * or .env file generation.  Merges system-reserved vars with user-declared vars.
 *
 * Stage 7B scope: generation only, no file I/O or docker execution.
 */

import type { BotSpec } from "./bot-spec.js";

/** Default base port when spec.gatewayPort is omitted and no offset is provided. */
const DEFAULT_GATEWAY_PORT = 18789;

export type GenerateEnvOptions = {
	/**
	 * Gateway auth token for this bot instance.
	 * If omitted, the env map will NOT include OPENCLAW_GATEWAY_TOKEN
	 * (caller is expected to provide it via .env file or external secret).
	 */
	gatewayToken?: string;

	/**
	 * Fallback port when spec.gatewayPort is undefined.
	 * Defaults to 18789.
	 */
	defaultPort?: number;
};

/**
 * Generate the environment variable map for a bot container.
 *
 * System vars (prefixed OPENCLAW_) are derived from the spec.
 * User vars from spec.env are merged last and can override system vars
 * if the user explicitly wants to (escape hatch).
 */
export function generateEnv(spec: BotSpec, options: GenerateEnvOptions = {}): Record<string, string> {
	const port = spec.gatewayPort ?? options.defaultPort ?? DEFAULT_GATEWAY_PORT;

	const systemEnv: Record<string, string> = {
		HOME: "/home/node",
		TERM: "xterm-256color",
		NODE_COMPILE_CACHE: "/var/tmp/openclaw-compile-cache",
		OPENCLAW_DEFAULT_MODEL: spec.model.id,
		OPENCLAW_GATEWAY_PORT: String(port),
	};

	if (options.gatewayToken) {
		systemEnv.OPENCLAW_GATEWAY_TOKEN = options.gatewayToken;
	}

	// User-declared env vars merge last (intentional override escape hatch)
	return { ...systemEnv, ...spec.env };
}
