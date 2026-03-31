/**
 * Finance expense formatter — domain layer.
 * Renders an ExpenseDraft into the fixed human-readable output template.
 * Field order is hardcoded — do not reorder without updating the spec.
 */

import type { ExpenseDraft } from "./parse-expense.js";

export function formatExpense(draft: ExpenseDraft): string {
  return [
    "=== Expense Draft ===",
    "",
    `Date: ${draft.date}`,
    `Amount: ${draft.amount}`,
    `Currency: ${draft.currency}`,
    `Category: ${draft.category}`,
    `Payment Method: ${draft.paymentMethod}`,
    `Paid By: ${draft.paidBy}`,
    `Business Purpose: ${draft.businessPurpose}`,
    `Reimbursable: ${draft.reimbursable}`,
    `Notes: ${draft.notes}`,
    "",
    "--- Extended ---",
    "",
    `Company: ${draft.company}`,
    `Project/Tag: ${draft.projectTag}`,
    `Receipt: ${draft.receipt}`,
    `Invoice: ${draft.invoice}`,
    `Asset Type: ${draft.assetType}`,
    `Depreciable: ${draft.depreciable}`,
    "",
    "---",
  ].join("\n");
}
