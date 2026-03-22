/**
 * Audit Store — file-backed append log + queryable reader for bot audit entries.
 *
 * Storage: one JSONL file at ~/.openclaw/bot-audit.jsonl (or OPENCLAW_BOT_AUDIT_FILE).
 * Each line is a JSON-serialized AuditEntry.
 *
 * Stage 8C.2 scope: file store + query.  No database, no rotation.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuditEntry } from "./auth.js";

/** Resolve the audit log file path. */
export function resolveAuditFilePath(): string {
	return process.env.OPENCLAW_BOT_AUDIT_FILE ??
		path.join(os.homedir(), ".openclaw", "bot-audit.jsonl");
}

let auditFileOverride: string | null = null;

/** Override audit file path (for testing). */
export function setAuditFilePath(filePath: string): void {
	auditFileOverride = filePath;
}

/** Reset to default path resolution (for testing). */
export function resetAuditFilePath(): void {
	auditFileOverride = null;
}

function getAuditFile(): string {
	return auditFileOverride ?? resolveAuditFilePath();
}

/**
 * Append an audit entry to the JSONL file.
 * Creates the file and parent directory if they don't exist.
 */
export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
	const filePath = getAuditFile();
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

export type AuditQuery = {
	/** Max entries to return. Default 10. */
	limit?: number;
	/** Filter by target bot ID. */
	botId?: string;
};

/**
 * Read audit entries from the JSONL file, newest first.
 *
 * Reads the entire file (suitable for small-to-medium audit logs).
 * For very large logs, a streaming tail approach would be better (future).
 */
export async function queryAuditEntries(query: AuditQuery = {}): Promise<AuditEntry[]> {
	const limit = query.limit ?? 10;
	const filePath = getAuditFile();

	let content: string;
	try {
		content = await fs.readFile(filePath, "utf-8");
	} catch {
		return []; // file doesn't exist yet
	}

	const lines = content.trim().split("\n").filter(Boolean);
	let entries: AuditEntry[] = [];

	// Parse in reverse (newest first) and stop early once we have enough
	for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
		try {
			const entry = JSON.parse(lines[i]) as AuditEntry;
			if (query.botId && entry.targetBotId !== query.botId) continue;
			entries.push(entry);
		} catch {
			// skip malformed lines
		}
	}

	return entries;
}

/**
 * Format audit entries for chat display.
 */
export function formatAuditEntries(entries: AuditEntry[], query: AuditQuery = {}): string {
	if (entries.length === 0) {
		return query.botId
			? `No audit records for bot "${query.botId}".`
			: "No audit records.";
	}

	const header = query.botId
		? `Bot audit for "${query.botId}" (last ${entries.length}):`
		: `Bot audit (last ${entries.length}):`;

	const lines = entries.map((e) => {
		const parts = [e.timestamp, `user=${e.userId}`, `cmd=${e.command}`];
		if (e.targetBotId) parts.push(`bot=${e.targetBotId}`);
		parts.push(`result=${e.result}`);
		return `- ${parts.join(" ")}`;
	});

	return `${header}\n${lines.join("\n")}`;
}
