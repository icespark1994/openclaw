import { isControlCommandMessage } from "../auto-reply/command-detection.js";
import type { OpenClawConfig } from "../config/types.js";

// ---------------------------------------------------------------------------
// Stage 10-A: Minimal Command Routing Protocol
// Classifies incoming message text into: control | skill | chat
// Pure function — no side effects, no behavioral changes in 10-A.
// ---------------------------------------------------------------------------

export type RouteType = "control" | "skill" | "chat";
export type RiskLevel = "low" | "medium" | "high";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface MessageRoute {
  /** Top-level routing bucket. */
  routeType: RouteType;
  /** Classification confidence. */
  confidence: ConfidenceLevel;
  /** Human-readable intent label, e.g. "bot-deploy" / "finance-skill" / "freeform-chat". */
  matchedIntent: string;
  /** Skill target when routeType === "skill", null otherwise. */
  target: string | null;
  /**
   * Specific action hint for the orchestrator (e.g. "deploy", "restart", "expense-record").
   * Reserved for future orchestrator dispatch; not used in 10-A.
   */
  actionHint: string | null;
  /**
   * Whether this action requires explicit user confirmation before execution.
   * Reserved for future confirmation flow; not enforced in 10-A.
   */
  requiresConfirmation: boolean;
  /**
   * Risk level for audit / permission gating.
   * Reserved for future permission layer; not enforced in 10-A.
   */
  riskLevel: RiskLevel;
}

// ---------------------------------------------------------------------------
// Skill registry
// ---------------------------------------------------------------------------

export const SKILL_REGISTRY = {
  finance: {
    id: "finance",
    description: "Finance expense / reimbursement tracking",
    type: "write" as const,
  },
  news: {
    id: "news",
    description: "News brief / daily summary fetch",
    type: "read" as const,
  },
  "ops-assistant": {
    id: "ops-assistant",
    description: "Bot ops automation (deploy / restart / status)",
    type: "write" as const,
  },
} as const;

export type SkillId = keyof typeof SKILL_REGISTRY;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Patterns that imply a destructive/high-risk control action. */
const HIGH_RISK_CONTROL_PATTERNS: ReadonlyArray<{
  re: RegExp;
  actionHint: string;
  requiresConfirmation: boolean;
}> = [
  {
    re: /\bbot[-\s]?deploy\b|^\/bot-deploy\b|\bdeploy\b/i,
    actionHint: "deploy",
    requiresConfirmation: true,
  },
  { re: /\bcreate[-\s]bot\b/i, actionHint: "deploy", requiresConfirmation: true },
  { re: /\brestart[-\s]bot\b/i, actionHint: "restart", requiresConfirmation: true },
  { re: /\bstop[-\s]bot\b/i, actionHint: "stop", requiresConfirmation: true },
];

/** Patterns for medium-risk control actions (no confirmation required). */
const MEDIUM_CONTROL_PATTERNS: ReadonlyArray<{
  re: RegExp;
  actionHint: string;
}> = [
  { re: /^\/bot-/i, actionHint: "bot-command" },
  { re: /\bstatus\b/i, actionHint: "status" },
  // Note: \b does not work before CJK characters; use lookahead/start-of-word workaround.
  { re: /(?:^|\s)挂\s*skill|\battach[-\s]skill\b/i, actionHint: "attach-skill" },
];

/** Patterns for finance skill. */
const FINANCE_PATTERNS =
  /\bfinance\b|\bexpense\b|\breimbursement\b|\breceipt\b|\bbookkeeping\b|\btransaction\b|\b报销\b|\b收据\b|\b账单\b|\b记账\b/i;

/** Patterns for news skill. */
const NEWS_PATTERNS = /\bnews brief\b|\bnews summary\b|\bdaily news\b|\b新闻摘要\b|\b每日新闻\b/i;

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a message into a {@link MessageRoute}.
 *
 * Rules are evaluated in priority order; first match wins.
 * Falls through to `chat` when no rule matches.
 *
 * @param text   Raw message text (use `msg.text ?? msg.caption ?? ""`).
 * @param cfg    Optional OpenClaw config; passed to existing command detection.
 */
export function classifyMessage(text: string, cfg?: OpenClawConfig): MessageRoute {
  const trimmed = text.trim();

  if (!trimmed) {
    return {
      routeType: "chat",
      confidence: "high",
      matchedIntent: "empty-message",
      target: null,
      actionHint: null,
      requiresConfirmation: false,
      riskLevel: "low",
    };
  }

  // Priority 1-2: High-risk control (deploy / create bot / restart / stop)
  for (const p of HIGH_RISK_CONTROL_PATTERNS) {
    if (p.re.test(trimmed)) {
      return {
        routeType: "control",
        confidence: "high",
        matchedIntent: `bot-${p.actionHint}`,
        target: null,
        actionHint: p.actionHint,
        requiresConfirmation: p.requiresConfirmation,
        riskLevel: "high",
      };
    }
  }

  // Priority 3-4: Medium-risk control (/bot-* prefix, status, attach-skill)
  for (const p of MEDIUM_CONTROL_PATTERNS) {
    if (p.re.test(trimmed)) {
      return {
        routeType: "control",
        confidence: "high",
        matchedIntent: p.actionHint,
        target: null,
        actionHint: p.actionHint,
        requiresConfirmation: false,
        riskLevel: "medium",
      };
    }
  }

  // Priority 5: Existing system command detection (OpenClaw built-in commands)
  if (isControlCommandMessage(trimmed, cfg)) {
    return {
      routeType: "control",
      confidence: "high",
      matchedIntent: "system-command",
      target: null,
      actionHint: "system-command",
      requiresConfirmation: false,
      riskLevel: "medium",
    };
  }

  // Priority 6: Finance skill
  if (FINANCE_PATTERNS.test(trimmed)) {
    return {
      routeType: "skill",
      confidence: "medium",
      matchedIntent: "finance-skill",
      target: "finance",
      actionHint: "finance-record",
      requiresConfirmation: false,
      riskLevel: "medium",
    };
  }

  // Priority 7: News skill
  if (NEWS_PATTERNS.test(trimmed)) {
    return {
      routeType: "skill",
      confidence: "medium",
      matchedIntent: "news-skill",
      target: "news",
      actionHint: "news-fetch",
      requiresConfirmation: false,
      riskLevel: "low",
    };
  }

  // Priority 8: Default — freeform chat
  return {
    routeType: "chat",
    confidence: "high",
    matchedIntent: "freeform-chat",
    target: null,
    actionHint: null,
    requiresConfirmation: false,
    riskLevel: "low",
  };
}
