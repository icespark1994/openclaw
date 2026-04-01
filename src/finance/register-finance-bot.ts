/**
 * Finance-bot in-process registration.
 *
 * Registers the finance module as an InProcessBot so it participates in the
 * generic message routing loop (routeMessageToInProcessBots).
 *
 * Design notes:
 * - This file is the sole coupling point between src/finance and the orchestrator.
 *   src/finance/** itself has no dependency on src/ops/bots.
 * - routeType + target from classifyMessage are interpreted here — not in dispatch,
 *   not inside handleFinanceMessage — keeping all domain-routing knowledge local.
 * - botId "finance-bot" namespaces the pending-draft store (Stage 11A micro-adj 2).
 *
 * Import this file once at startup for its side effect (registerInProcessBot call).
 */

import { registerInProcessBot, type InProcessBot } from "../ops/bots/in-process-registry.js";
import { handleFinanceMessage } from "./index.js";

let _running = true;

const financeBot: InProcessBot = {
  id: "finance-bot",
  name: "Finance Bot",
  skills: ["finance/expense_v1"],

  async handleMessage(text, sessionKey, routeType, target) {
    if (!_running) {
      return null;
    }
    const result = await handleFinanceMessage(text, {
      sessionKey,
      botId: "finance-bot",
      // A "new" finance request is when the classifier routed this message
      // to the finance skill specifically.  Continuations (yes/no) arrive as
      // chat messages — isNewFinanceRequest = false, handled via pending drafts.
      isNewFinanceRequest: routeType === "skill" && target === "finance",
    });
    return result.handled ? result.reply : null;
  },

  getStatus: () => (_running ? "running" : "stopped"),
  restart() {
    _running = true;
  },
  stop() {
    _running = false;
  },
};

registerInProcessBot(financeBot);
