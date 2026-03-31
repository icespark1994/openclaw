/**
 * Public API for the finance module.
 *
 * Callers (control bot, future finance-bot) should only import from here.
 * Internal layer structure (domain / application / infrastructure) is
 * an implementation detail — do not import from sub-paths directly.
 */

export type { FinanceMessageContext, FinanceMessageResult } from "./application/finance-service.js";
export { handleFinanceMessage } from "./application/finance-service.js";
