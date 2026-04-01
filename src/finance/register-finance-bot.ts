/**
 * Finance-bot in-process registration.
 *
 * Registers the finance module as an InProcessBot so it participates in the
 * generic message routing loop (routeMessageToInProcessBots).
 *
 * Stage 11C guard: only registers when OPENCLAW_BOT_ID === "finance-bot".
 *   - finance-bot container: OPENCLAW_BOT_ID is set via spec.env → self-registers.
 *   - control-bot process: OPENCLAW_BOT_ID is unset → this file is a no-op.
 *
 * This file is the sole coupling point between src/finance and the orchestrator.
 * src/finance/** itself has no dependency on src/ops/bots.
 */

import { registerInProcessBot, type InProcessBot } from "../ops/bots/in-process-registry.js";
import { handleFinanceMessage } from "./index.js";

// Guard: do not register in the control-bot process or any other runtime.
// Only the finance-bot container sets OPENCLAW_BOT_ID=finance-bot.
if (process.env.OPENCLAW_BOT_ID === "finance-bot") {
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
}
