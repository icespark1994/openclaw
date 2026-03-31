/**
 * Maps an ExpenseDraft + generated Expense ID to the 20-column
 * Google Sheet row.  Column order is hardcoded to match the sheet template.
 *
 * Column index → field:
 *  0  Expense ID          (system-generated)
 *  1  Date
 *  2  Category
 *  3  Amount
 *  4  Currency
 *  5  Payment Method
 *  6  Paid By
 *  7  Company
 *  8  Business Purpose
 *  9  Project/Tag
 * 10  Reimbursable
 * 11  Reimbursed          (default: No)
 * 12  Reimbursement Date  (default: empty)
 * 13  Reimbursed To       (default: empty)
 * 14  Receipt
 * 15  Receipt Link        (default: empty)
 * 16  Invoice
 * 17  Asset Type
 * 18  Depreciable
 * 19  Notes
 */

import type { ExpenseDraft } from "../domain/parse-expense.js";

export function draftToRow(draft: ExpenseDraft, expenseId: string): string[] {
  return [
    expenseId, // 0  Expense ID
    draft.date, // 1  Date
    draft.category, // 2  Category
    draft.amount, // 3  Amount
    draft.currency, // 4  Currency
    draft.paymentMethod, // 5  Payment Method
    draft.paidBy, // 6  Paid By
    draft.company, // 7  Company
    draft.businessPurpose, // 8  Business Purpose
    draft.projectTag, // 9  Project/Tag
    draft.reimbursable, // 10 Reimbursable
    "No", // 11 Reimbursed (default)
    "", // 12 Reimbursement Date (default empty)
    "", // 13 Reimbursed To (default empty)
    draft.receipt, // 14 Receipt
    "", // 15 Receipt Link (default empty)
    draft.invoice, // 16 Invoice
    draft.assetType, // 17 Asset Type
    draft.depreciable, // 18 Depreciable
    draft.notes, // 19 Notes
  ];
}
