/**
 * Expense ID generation — domain layer.
 *
 * Format: EXP-YYYY-NNN  (strict — exactly 3 digits, zero-padded)
 * Strategy: read existing IDs from the sheet, find the highest NNN for the
 * current year, return NNN+1.  Survives container restarts because the source
 * of truth is the sheet, not process memory.
 *
 * Race-condition note: two concurrent writes within the same second could
 * collide. Acceptable for MVP single-bot usage.
 */

/** Strict pattern: EXP-YYYY-NNN (exactly 4-digit year, exactly 3-digit seq). */
const EXPENSE_ID_RE = /^EXP-(\d{4})-(\d{3})$/;

/**
 * @param readFn - async function that returns all existing Expense ID strings
 *                 (injected for testability; production uses readExpenseIds from sheets-write.ts)
 */
export async function generateExpenseId(readFn: () => Promise<string[]>): Promise<string> {
  const year = new Date().getFullYear();
  const yearStr = String(year);

  const existing = await readFn();

  const nums: number[] = [];
  for (const id of existing) {
    const m = EXPENSE_ID_RE.exec(id);
    if (m && m[1] === yearStr) {
      nums.push(parseInt(m[2], 10));
    }
  }

  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `EXP-${yearStr}-${String(next).padStart(3, "0")}`;
}
