/**
 * Pending Draft Cache — in-memory store for per-user draft-deploy workflows.
 *
 * Each user can have at most one pending draft.  Memory only, no persistence.
 *
 * Stage 8D scope: minimal conversational state for confirm/cancel flow.
 */

/** A pending draft waiting for user confirmation. */
export type PendingDraft = {
	/** Raw YAML text ready for deployFromYaml. */
	yaml: string;
	/** Bot ID from the draft (for display). */
	botId: string;
	/** When the draft was created (ISO string). */
	createdAt: string;
};

const drafts = new Map<string, PendingDraft>();

/** Store a pending draft for a user. Replaces any previous draft. */
export function setPendingDraft(userId: string, draft: PendingDraft): void {
	drafts.set(userId, draft);
}

/** Get the pending draft for a user, or undefined. */
export function getPendingDraft(userId: string): PendingDraft | undefined {
	return drafts.get(userId);
}

/** Clear the pending draft for a user. Returns true if one existed. */
export function clearPendingDraft(userId: string): boolean {
	return drafts.delete(userId);
}

/** Clear all pending drafts (for testing). */
export function clearAllPendingDrafts(): void {
	drafts.clear();
}
