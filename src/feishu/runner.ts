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

  return `You are an expert medical technology news analyst specializing in AI applications across the medical device industry.

Task: Search for and summarize the most important recent news (past 24 hours) on AI in medical devices. Focus strictly on medical-device-specific AI news — do NOT include generic AI, pharma, or biotech stories unless they directly involve a physical or software medical device cleared or in development.

Topics of interest (use these as search keywords):
${keywords}

Priority topics:
- FDA AI/ML-enabled medical device clearances (510(k), De Novo, PMA)
- AI surgical robotics product launches or clinical data
- AI medical imaging and diagnostics device approvals or studies
- AI wearable and remote patient monitoring device news
- AI cardiovascular and neurovascular device news
- Significant medtech AI funding rounds or acquisitions (>$20M or strategic)
- AI SaMD (Software as a Medical Device) regulatory updates

Output rules:
1. Return ${targetItems}-${maxItems} high-quality, real news items. Each on its own line.
2. Each line MUST follow EXACTLY this pipe-delimited format (no extra pipes within fields):
   TITLE | ONE_SENTENCE_SUMMARY | WHY_IT_MATTERS | SOURCE_URL | CATEGORY
   where CATEGORY is one of: AI-MedDevice, Imaging-Diagnostics, Surgical-Robotics, Cardiovascular-Neuro, Wearables-RPM, Regulatory-FDA, Commercial-Industry
3. Include real, verifiable URLs only. Do NOT fabricate URLs.
4. If you cannot find at least ${minItems} high-quality, real medical-device AI news items with real URLs, output exactly:
   NO_ENOUGH_NEWS
   Do not fabricate or make up news stories.
5. Prioritize: FDA clearances, clinical data, regulatory submissions, product launches, significant funding.
6. Skip generic AI news, drug/biotech stories without a device component, and low-quality press releases.
7. Do not include any explanation, headers, or footer — output only the pipe-delimited lines or the NO_ENOUGH_NEWS sentinel.

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
