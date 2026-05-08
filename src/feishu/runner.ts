/**
 * Feishu AI-medtech daily news digest runner.
 *
 * Fetches today's news via OpenRouter, formats, and sends to Feishu.
 *
 * Required env:
 *   OPENROUTER_API_KEY   — OpenRouter API key
 *   FEISHU_WEBHOOK_URL   — Feishu custom bot webhook URL
 *
 * Optional env:
 *   FEISHU_WEBHOOK_SECRET  — HMAC signing secret
 *   DRY_RUN=1              — print output, do not send to Feishu
 *   AI_MEDTECH_NEWS_TIMEZONE — informational; used in date label only
 *
 * Usage:
 *   bun src/feishu/runner.ts
 *   DRY_RUN=1 bun src/feishu/runner.ts
 */

import { request } from "undici";
import { formatDigest, parseLLMOutput } from "./format.js";
import { DIGEST_CONFIG, allKeywords } from "./news-topics.js";
import { sendFeishuText } from "./send.js";

const DRY_RUN = process.env.DRY_RUN === "1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// Default to Perplexity sonar-pro (real-time web search built-in via OpenRouter).
// Set AI_MEDTECH_NEWS_MODEL to override (e.g. perplexity/sonar for lower cost).
const MODEL = process.env.AI_MEDTECH_NEWS_MODEL ?? "perplexity/sonar-pro";

// OpenRouter uses the same API shape as OpenAI; strip the "openrouter/" prefix if present.
function resolveModelId(model: string): string {
  return model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;
}

function todayLabel(): string {
  const tz = process.env.AI_MEDTECH_NEWS_TIMEZONE ?? "Asia/Shanghai";
  try {
    return new Date().toLocaleDateString("zh-CN", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildPrompt(): string {
  const keywords = allKeywords();
  const maxItems = DIGEST_CONFIG.maxItems;
  const targetItems = DIGEST_CONFIG.targetItems;
  const minItems = DIGEST_CONFIG.minItems;
  const primary = DIGEST_CONFIG.primaryLookbackDays;
  const fallback = DIGEST_CONFIG.fallbackLookbackDays;
  const extended = DIGEST_CONFIG.extendedLookbackDays;

  return `You are an expert medical technology news analyst specializing in AI applications across the medical device industry.

Task: Search for and summarize recent AI medical device industry news using a tiered time-window strategy. Focus strictly on medical-device-specific AI news — exclude generic AI, pharma, or pure biotech stories unless they directly involve a cleared or in-development medical device product.

Search keywords (use these to find English and international sources):
${keywords}

TIERED SEARCH STRATEGY — execute in order, stop when you have enough items:
Step 1: Search the past ${primary} day (24 hours) for AI medical device news.
  → If you find at least ${minItems} high-quality items with verifiable URLs, use only those.
Step 2: If fewer than ${minItems} items in 24h, expand to the past ${fallback} days (72 hours).
  → Recent news within 72h is equally valuable — do not reject it just because it is not from today.
Step 3: If still fewer than ${minItems} items, expand to the past ${extended} days.
  → FDA clearances, major funding rounds, and product launches from the past week remain relevant to industry readers.
Output NO_ENOUGH_NEWS only if you cannot find ${minItems} quality items with real URLs even within ${extended} days.

Priority topics:
- FDA AI/ML-enabled medical device clearances (510(k), De Novo, PMA)
- AI surgical robotics product launches or clinical data
- AI medical imaging and diagnostics device approvals or studies
- AI wearable and remote patient monitoring device news
- AI cardiovascular and neurovascular device news
- Significant medtech AI funding rounds or acquisitions (>$20M or strategic)
- AI SaMD (Software as a Medical Device) regulatory updates
- Neurointervention / neurovascular industry financing, M&A, acquisitions, strategic investment, IPO, licensing or partnership deals (e.g. Cerenovus, Stryker Neurovascular, Medtronic neurovascular, Penumbra, MicroVention, Balt, Wallaby Medical, Rapid Medical, Imperative Care, Synchron, Route 92 Medical, Q'Apel Medical, Ceretrieve, Vesalio, or any stroke/thrombectomy/aneurysm/flow-diverter/stent-retriever/embolization device company)

Output rules:
1. Return ${minItems}–${maxItems} high-quality, real news items, one per line (target ${targetItems}; send if at least ${minItems} found).
2. Sort newest first within the result set.
3. IMPORTANT: Write all text fields in Simplified Chinese (简体中文). Do NOT write in English except where noted below.
4. Each line MUST follow EXACTLY this pipe-delimited format (no pipes within fields):
   中文标题 | 一句话中文摘要 | 中文行业重要性 | SOURCE_URL | CATEGORY
   Where:
   - 中文标题: Simplified Chinese title. You may append the original English title or date in parentheses, e.g. "（AcuityMD 融资报道，2026-05-01）"
   - 一句话中文摘要: One concise Simplified Chinese sentence; high information density for medical device industry readers
   - 中文行业重要性: Simplified Chinese explanation of why this matters to the AI medical device industry
   - SOURCE_URL: Original URL unchanged — do NOT translate
   - CATEGORY: ONE of these exact English tokens (do not translate): AI-MedDevice, Imaging-Diagnostics, Surgical-Robotics, Cardiovascular-Neuro, Wearables-RPM, Regulatory-FDA, Commercial-Industry, Neurointervention-Deals
5. Use only real, verifiable URLs. Do NOT fabricate links.
6. Output NO_ENOUGH_NEWS (exactly this string) only if the ${extended}-day window yields fewer than ${minItems} qualifying items.
7. Skip: generic AI news, biotech-only stories without a device component, low-quality press releases.
8. Do not include any explanation, headers, or footers — output only the pipe-delimited lines or the NO_ENOUGH_NEWS sentinel.

Begin:`;
}

async function fetchNewsFromOpenRouter(): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const modelId = resolveModelId(MODEL);
  const prompt = buildPrompt();

  const resp = await request("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/icespark1994/openclaw",
      "X-Title": "Feishu AI-Medtech News Digest",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
    bodyTimeout: 90_000,
    headersTimeout: 30_000,
  });

  const body = await resp.body.text();

  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`OpenRouter HTTP ${resp.statusCode}: ${body}`);
  }

  interface OpenRouterResponse {
    choices?: Array<{
      message?: { content?: string };
    }>;
    error?: { message?: string };
  }

  const parsed = JSON.parse(body) as OpenRouterResponse;

  if (parsed.error?.message) {
    throw new Error(`OpenRouter error: ${parsed.error.message}`);
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned empty content");
  }

  return content;
}

async function run(): Promise<void> {
  console.log(`[feishu-runner] Starting. DRY_RUN=${DRY_RUN} MODEL=${MODEL}`);

  const dateLabel = todayLabel();
  console.log(`[feishu-runner] Date label: ${dateLabel}`);

  console.log("[feishu-runner] Calling OpenRouter for news digest...");
  const rawOutput = await fetchNewsFromOpenRouter();
  console.log(`[feishu-runner] Raw LLM output (${rawOutput.length} chars):\n${rawOutput}\n`);

  const items = parseLLMOutput(rawOutput);
  const capped = items.slice(0, DIGEST_CONFIG.maxItems);

  console.log(
    `[feishu-runner] Parsed ${items.length} items → ${capped.length} after cap (min=${DIGEST_CONFIG.minItems})`,
  );

  const message = formatDigest(capped, dateLabel);

  console.log("[feishu-runner] Formatted message:\n");
  console.log(message);
  console.log();

  if (DRY_RUN) {
    console.log("[feishu-runner] DRY_RUN=1 — skipping Feishu send.");
    return;
  }

  console.log("[feishu-runner] Sending to Feishu...");
  await sendFeishuText(message);
  console.log(
    `[feishu-runner] ✅ Sent ${capped.length === 0 ? "no-news notice" : `${capped.length} items`} to Feishu.`,
  );
}

run().catch((err: unknown) => {
  console.error("[feishu-runner] ❌ Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
