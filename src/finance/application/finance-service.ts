/**
 * Finance service — application layer.
 *
 * Owns the full finance message lifecycle:
 *   parse → store pending draft → confirm/cancel/overwrite → commit to Sheet
 *
 * The public entry point for the control bot (and future finance-bot) is
 * handleFinanceMessage().  It returns a discriminated union so callers
 * never need to inspect internal state.
 *
 * Design notes:
 * - FinanceMessageContext is decoupled from MessageRoute / SkillContext so
 *   this module can be mounted in any bot without pulling in control-bot types.
 * - Yes/No detection is self-contained (not imported from control-confirmation)
 *   for the same reason.
 * - The store key is always derived via makeFinanceStoreKey(botId, sessionKey),
 *   keeping pending state scoped per bot in multi-bot deployments.
 */

import { logVerbose } from "../../globals.js";
import { generateExpenseId } from "../domain/expense-id.js";
import { formatExpense } from "../domain/format-expense.js";
import { parseExpense } from "../domain/parse-expense.js";
import { draftToRow } from "../infrastructure/draft-to-row.js";
import { appendExpenseRow, readExpenseIds } from "../infrastructure/sheets-write.js";
import {
  clearPendingFinanceDraft,
  getPendingFinanceDraft,
  makeFinanceStoreKey,
  setPendingFinanceDraft,
} from "./pending-draft.js";

// ---------------------------------------------------------------------------
// Public context / result types
// ---------------------------------------------------------------------------

/**
 * Context passed by the caller to handleFinanceMessage.
 *
 * Deliberately does not reference MessageRoute or SkillContext so this
 * module stays portable across control-bot and future finance-bot entry points.
 */
export interface FinanceMessageContext {
  /** Raw session key (chatId or chatId:threadId). */
  sessionKey: string;
  /**
   * Bot identifier — used as namespace prefix in the pending store to
   * prevent key collisions when multiple bots share the same process.
   * Use "control" for the current single-bot setup.
   */
  botId: string;
  /**
   * True when the caller has already determined the message is a new
   * expense input (e.g. classifyMessage returned skill/finance).
   * The finance module never inspects MessageRoute directly.
   */
  isNewFinanceRequest: boolean;
}

export type FinanceMessageResult = { handled: true; reply: string } | { handled: false };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Stale draft TTL: 30 minutes. Abandoned drafts are auto-cleared. */
const PENDING_FINANCE_TTL_MS = 30 * 60 * 1000;

function isYes(text: string): boolean {
  return new Set(["yes", "confirm"]).has(text.trim().toLowerCase());
}

function isNo(text: string): boolean {
  return new Set(["no", "cancel"]).has(text.trim().toLowerCase());
}

/** Parse text, store pending draft, return formatted draft + confirmation prompt. */
async function createDraft(text: string, storeKey: string): Promise<string> {
  const draft = parseExpense(text);
  setPendingFinanceDraft({ sessionKey: storeKey, draft, createdAt: Date.now() });
  return (
    formatExpense(draft) +
    '\n\nReply "yes" or "confirm" to write to ledger, or "no" or "cancel" to abort.'
  );
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function commitFinanceDraft(draft: ReturnType<typeof parseExpense>): Promise<string> {
  logVerbose("[finance] committing draft to Google Sheet");

  let expenseId: string;
  try {
    expenseId = await generateExpenseId(readExpenseIds);
  } catch (err) {
    logVerbose(`[finance] failed to generate expense ID: ${String(err)}`);
    throw err;
  }

  const row = draftToRow(draft, expenseId);

  try {
    await appendExpenseRow(row);
  } catch (err) {
    logVerbose(`[finance] sheet write failed: ${String(err)}`);
    throw err;
  }

  logVerbose(`[finance] wrote expense ID=${expenseId}`);
  return `Expense recorded successfully.\nExpense ID: ${expenseId}`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Handles a single incoming message in the finance domain.
 *
 * Covers all finance states in priority order:
 *  1. Stale draft (> 30 min) → auto-clear, fall through
 *  2. Pending + YES            → commit to Sheet
 *  3. Pending + NO             → cancel
 *  4. Pending + new finance    → overwrite draft (Fix 10-F/3)
 *  5. Pending + other          → re-prompt
 *  6. No pending + new finance → create draft
 *  7. No pending + other       → { handled: false } (caller handles via LLM etc.)
 */
export async function handleFinanceMessage(
  text: string,
  ctx: FinanceMessageContext,
): Promise<FinanceMessageResult> {
  const storeKey = makeFinanceStoreKey(ctx.botId, ctx.sessionKey);
  const pending = getPendingFinanceDraft(storeKey);

  if (pending != null) {
    // 1. Staleness guard — discard abandoned drafts.
    if (Date.now() - pending.createdAt > PENDING_FINANCE_TTL_MS) {
      logVerbose(`[finance] stale pending draft auto-cleared key=${storeKey}`);
      clearPendingFinanceDraft(storeKey);
      // fall through to no-pending branch below
    } else if (isYes(text)) {
      // 2. Confirm → commit
      logVerbose(`[finance] YES received key=${storeKey}`);
      clearPendingFinanceDraft(storeKey);
      try {
        const reply = await commitFinanceDraft(pending.draft);
        return { handled: true, reply };
      } catch (err) {
        return { handled: true, reply: `Failed to write expense: ${String(err)}` };
      }
    } else if (isNo(text)) {
      // 3. Cancel
      logVerbose(`[finance] NO received key=${storeKey}`);
      clearPendingFinanceDraft(storeKey);
      return { handled: true, reply: "Finance entry cancelled. No record was written." };
    } else if (ctx.isNewFinanceRequest) {
      // 4. New expense while one is pending — overwrite, don't re-prompt old draft.
      logVerbose(`[finance] new request while pending — overwriting draft key=${storeKey}`);
      const reply = await createDraft(text, storeKey);
      return { handled: true, reply };
    } else {
      // 5. Unrecognised input — re-prompt.
      logVerbose(`[finance] unrecognized reply while pending key=${storeKey}`);
      return {
        handled: true,
        reply:
          'Waiting for your confirmation on the expense draft. Reply "yes" or "confirm" to write to ledger, or "no" or "cancel" to abort.',
      };
    }
  }

  // No active (non-stale) draft at this point.
  if (ctx.isNewFinanceRequest) {
    // 6. Fresh finance input — parse and store.
    logVerbose(`[finance] new request key=${storeKey}`);
    const reply = await createDraft(text, storeKey);
    return { handled: true, reply };
  }

  // 7. Not a finance message and no pending draft — caller should handle.
  return { handled: false };
}
