/**
 * Bot Command Authorization — minimal RBAC for /bot-* commands.
 *
 * Three roles: owner > admin > viewer.
 * Config source: OPENCLAW_BOT_OWNERS / OPENCLAW_BOT_ADMINS / OPENCLAW_BOT_VIEWERS
 * env vars (comma-separated user IDs), or programmatic setAuthorizedUsers().
 *
 * Stage 8C.1 scope: auth + audit only.  No complex RBAC, no UI.
 */

import { logVerbose } from "../../globals.js";
import { appendAuditEntry } from "./audit.js";

// ── Roles & permissions ──────────────────────────────────────────────

export type BotRole = "owner" | "admin" | "viewer";

/** Actions that map to parsed command types. */
export type BotAction = "deploy" | "stop" | "restart" | "list" | "status" | "help" | "audit" | "draft" | "draft-deploy" | "confirm" | "cancel";

const ROLE_PERMISSIONS: Record<BotRole, Set<BotAction>> = {
	owner: new Set(["deploy", "stop", "restart", "list", "status", "help", "audit", "draft", "draft-deploy", "confirm", "cancel"]),
	admin: new Set(["stop", "restart", "list", "status", "help", "audit", "draft"]),
	viewer: new Set(["list", "status", "help", "audit"]),
};

// ── User config ──────────────────────────────────────────────────────

export type AuthorizedUsers = {
	owner: string[];
	admin: string[];
	viewer: string[];
};

let userConfig: AuthorizedUsers | null = null;

/** Load authorized users from env vars (lazy, cached). */
function loadAuthorizedUsers(): AuthorizedUsers {
	if (userConfig) return userConfig;
	userConfig = {
		owner: parseEnvList(process.env.OPENCLAW_BOT_OWNERS),
		admin: parseEnvList(process.env.OPENCLAW_BOT_ADMINS),
		viewer: parseEnvList(process.env.OPENCLAW_BOT_VIEWERS),
	};
	return userConfig;
}

function parseEnvList(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Override authorized users (for testing or programmatic config). */
export function setAuthorizedUsers(users: AuthorizedUsers): void {
	userConfig = users;
}

/** Reset to env-based resolution (for testing). */
export function resetAuthorizedUsers(): void {
	userConfig = null;
}

// ── Resolution ───────────────────────────────────────────────────────

/** Resolve the highest role for a user ID. Returns null if not authorized. */
export function resolveUserRole(userId: string | undefined): BotRole | null {
	if (!userId) return null;
	const users = loadAuthorizedUsers();
	const normalized = userId.trim();
	if (users.owner.includes(normalized)) return "owner";
	if (users.admin.includes(normalized)) return "admin";
	if (users.viewer.includes(normalized)) return "viewer";
	return null;
}

/** Check if a user can perform a specific action. */
export function checkBotCommandPermission(userId: string | undefined, action: BotAction): boolean {
	const role = resolveUserRole(userId);
	if (!role) return false;
	return ROLE_PERMISSIONS[role].has(action);
}

/** Get the minimum role required for an action. */
export function requiredRoleForAction(action: BotAction): BotRole {
	if (ROLE_PERMISSIONS.viewer.has(action)) return "viewer";
	if (ROLE_PERMISSIONS.admin.has(action)) return "admin";
	return "owner";
}

/** Build a user-facing denial message. */
export function buildDenialMessage(action: BotAction, role: BotRole | null): string {
	if (!role) {
		return "Unauthorized: you are not allowed to run this command.";
	}
	const required = requiredRoleForAction(action);
	return `Permission denied: ${action} requires ${required} role.`;
}

// ── Audit ────────────────────────────────────────────────────────────

export type AuditEntry = {
	timestamp: string;
	userId: string;
	command: string;
	targetBotId?: string;
	result: "success" | "denied" | "error";
};

/** Emit an audit log entry. Logs to verbose output and persists to audit file. */
export function emitAuditLog(entry: AuditEntry): void {
	const parts = [
		`[bot-audit]`,
		`user=${entry.userId}`,
		`command=${entry.command}`,
	];
	if (entry.targetBotId) parts.push(`bot=${entry.targetBotId}`);
	parts.push(`result=${entry.result}`);
	parts.push(`timestamp=${entry.timestamp}`);
	logVerbose(parts.join(" "));
	// Persist to file (fire-and-forget; don't block command response)
	appendAuditEntry(entry).catch(() => {});
}
