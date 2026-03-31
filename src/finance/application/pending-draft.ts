/**
 * In-memory pending finance draft store — application layer.
 *
 * One draft slot per (botId, sessionKey) pair.
 * The compound key prevents session collisions in multi-bot deployments.
 */

import { logVerbose } from "../../globals.js";
import type { ExpenseDraft } from "../domain/parse-expense.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinancePendingDraft {
  /** Compound store key: makeFinanceStoreKey(botId, sessionKey). */
  sessionKey: string;
  draft: ExpenseDraft;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Store (module-level singleton — one instance per process)
// ---------------------------------------------------------------------------

const pendingFinanceDrafts = new Map<string, FinancePendingDraft>();

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/**
 * Builds the Map key scoped by botId to prevent session collisions when
 * multiple finance bots share the same process or session-key namespace.
 *
 * Example: makeFinanceStoreKey("control", "123456") → "control:123456"
 */
export function makeFinanceStoreKey(botId: string, sessionKey: string): string {
  return `${botId}:${sessionKey}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function setPendingFinanceDraft(entry: FinancePendingDraft): void {
  pendingFinanceDrafts.set(entry.sessionKey, entry);
  logVerbose(`[finance] stored pending draft key=${entry.sessionKey}`);
}

export function getPendingFinanceDraft(key: string): FinancePendingDraft | undefined {
  return pendingFinanceDrafts.get(key);
}

export function clearPendingFinanceDraft(key: string): void {
  const had = pendingFinanceDrafts.delete(key);
  if (had) {
    logVerbose(`[finance] cleared pending draft key=${key}`);
  }
}
