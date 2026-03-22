/**
 * Bot Draft Service — converts a natural-language description into a BotSpec YAML draft.
 *
 * No LLM call, no deployment, no file write.  Pure keyword-based heuristic.
 *
 * Stage 8C.3 scope: draft generation only.
 */

import YAML from "yaml";

// ── Skill keyword mapping ────────────────────────────────────────────

type SkillMapping = { keywords: string[]; skill: string };

const SKILL_MAPPINGS: SkillMapping[] = [
	{ keywords: ["news", "search", "web", "browse", "fetch", "scrape", "crawl", "url"], skill: "web-search" },
	{ keywords: ["ops", "infra", "docker", "server", "deploy", "devops", "monitor", "log", "diagnostic"], skill: "ops-read" },
	{ keywords: ["canvas", "file", "document", "artifact", "write", "draft"], skill: "canvas" },
	{ keywords: ["github", "pr", "issue", "repo", "commit", "git"], skill: "github" },
	{ keywords: ["image", "photo", "picture", "screenshot", "vision"], skill: "openai-image-gen" },
	{ keywords: ["weather", "forecast", "temperature"], skill: "weather" },
	{ keywords: ["slack"], skill: "slack" },
	{ keywords: ["discord"], skill: "discord" },
	{ keywords: ["telegram"], skill: "tmux" },
	{ keywords: ["notion"], skill: "notion" },
	{ keywords: ["trello", "board", "kanban"], skill: "trello" },
	{ keywords: ["spotify", "music", "song"], skill: "spotify-player" },
	{ keywords: ["schedule", "cron", "timer", "periodic"], skill: "oracle" },
	{ keywords: ["pdf"], skill: "nano-pdf" },
	{ keywords: ["video", "frame"], skill: "video-frames" },
	{ keywords: ["tts", "speech", "voice", "speak"], skill: "sherpa-onnx-tts" },
];

/** Extract skills from a description by keyword matching. */
function matchSkills(description: string): string[] {
	const lower = description.toLowerCase();
	const matched = new Set<string>();
	for (const { keywords, skill } of SKILL_MAPPINGS) {
		if (keywords.some((kw) => lower.includes(kw))) {
			matched.add(skill);
		}
	}
	return [...matched];
}

// ── ID generation ────────────────────────────────────────────────────

/** Generate a kebab-case bot ID from a description. */
function generateBotId(description: string): string {
	const words = description
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter(Boolean);

	// Filter out noise words
	const noise = new Set(["a", "an", "the", "that", "this", "which", "and", "or", "for", "to", "of",
		"is", "it", "my", "me", "i", "with", "on", "in", "at", "by", "do", "does",
		"create", "make", "build", "new", "bot", "agent", "please", "can", "could", "should", "uses"]);
	const meaningful = words.filter((w) => !noise.has(w));

	// Take first 3-4 meaningful words
	const slug = meaningful.slice(0, 4).join("-");
	return slug || "custom-bot";
}

/** Generate a human-readable name from a bot ID. */
function generateBotName(id: string): string {
	return id
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ") + " Bot";
}

// ── Draft generation ─────────────────────────────────────────────────

export type DraftResult = {
	ok: boolean;
	message: string;
};

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

/**
 * Generate a BotSpec YAML draft from a natural-language description.
 *
 * Returns a user-facing message with the draft and next-step instructions.
 */
export function generateBotDraft(description: string): DraftResult {
	const trimmed = description.trim();
	if (!trimmed) {
		return { ok: false, message: "Usage: /bot-draft <description of what the bot should do>" };
	}

	const id = generateBotId(trimmed);
	const name = generateBotName(id);
	const skills = matchSkills(trimmed);

	const spec = {
		version: 1,
		id,
		name,
		description: trimmed,
		model: { id: DEFAULT_MODEL },
		skills,
		enabled: true,
	};

	const yaml = YAML.stringify(spec, {
		lineWidth: 120,
		defaultKeyType: "PLAIN",
		defaultStringType: "PLAIN",
	});

	const assumptions: string[] = [];
	if (skills.length === 0) {
		assumptions.push("No skills matched — add skills manually if needed.");
	}
	assumptions.push(`Model: ${DEFAULT_MODEL} (change as needed).`);

	const parts = [
		`Draft bot spec for: "${trimmed}"`,
		"",
		"```yaml",
		yaml.trimEnd(),
		"```",
		"",
		`Assumptions: ${assumptions.join(" ")}`,
		"",
		"Review this draft, then run /bot-deploy <yaml> to deploy.",
	];

	return { ok: true, message: parts.join("\n") };
}
