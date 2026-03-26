/**
 * Stage 10-E: In-memory pending finance draft store.
 * One slot per session; persists until user confirms or cancels.
 * Structure mirrors control-confirmation.ts for consistency.
 */

import { logVerbose } from "../../globals.js";
import type { ExpenseDraft } from "./parse-expense.js";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export interface FinancePendingDraft {
  sessionKey: string;
  draft: ExpenseDraft;
  createdAt: number; // Unix ms — reserved for future TTL
}

// ---------------------------------------------------------------------------
// Store (module-level singleton)
// ---------------------------------------------------------------------------

export const pendingFinanceDrafts = new Map<string, FinancePendingDraft>();

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function setPendingFinanceDraft(entry: FinancePendingDraft): void {
  pendingFinanceDrafts.set(entry.sessionKey, entry);
  logVerbose(`[finance] stored pending draft sessionKey=${entry.sessionKey}`);
}

export function getPendingFinanceDraft(key: string): FinancePendingDraft | undefined {
  return pendingFinanceDrafts.get(key);
}

export function clearPendingFinanceDraft(key: string): void {
  const had = pendingFinanceDrafts.delete(key);
  if (had) {
    logVerbose(`[finance] cleared pending draft sessionKey=${key}`);
  }
}
