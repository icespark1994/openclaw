/**
 * Stage 10-D/E: Finance skill handler.
 *
 * Stage 10-D: parse natural-language expense → structured ExpenseDraft.
 * Stage 10-E: store draft as pending confirmation; on YES commit to Google Sheet.
 *
 * commitFinanceDraft() is exported separately so the dispatch layer can call it
 * without re-importing the pending store.
 */

import { logVerbose } from "../../globals.js";
import type { SkillContext } from "../../routing/skill-handlers.js";
import { draftToRow } from "./draft-to-row.js";
import { generateExpenseId } from "./expense-id.js";
import { formatExpense } from "./format-expense.js";
import { parseExpense } from "./parse-expense.js";
import { setPendingFinanceDraft } from "./pending-draft.js";
import { appendExpenseRow, readExpenseIds } from "./sheets-write.js";

// ---------------------------------------------------------------------------
// Handler: parse → store pending → return draft + prompt
// ---------------------------------------------------------------------------

export async function financeHandler(text: string, ctx: SkillContext): Promise<string> {
  const draft = parseExpense(text);
  setPendingFinanceDraft({ sessionKey: ctx.sessionKey, draft, createdAt: Date.now() });

  const draftText = formatExpense(draft);
  return (
    draftText + '\n\nReply "yes" or "confirm" to write to ledger, or "no" or "cancel" to abort.'
  );
}

// ---------------------------------------------------------------------------
// Commit: generate ID → map to row → append to sheet
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
