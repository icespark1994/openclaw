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

  return `你是一位专注于 AI 医疗器械行业的医疗科技资讯分析师。

任务：使用分层时间窗口策略，检索并整理 AI 在医疗器械领域最重要的近期新闻动态。严格聚焦于医疗器械相关的 AI 新闻，不要收录泛 AI、制药、纯生物技术的内容，除非其直接涉及已获批或在研的医疗器械产品。

检索关键词（可使用英文关键词检索英文来源，但输出必须是中文）：
${keywords}

分层检索策略（按顺序执行，找到足够条目即停止）：
第一步：检索过去 ${primary} 天（24 小时）内的 AI 医疗器械新闻。
  → 如果能找到至少 ${minItems} 条高质量、有可验证 URL 的新闻，直接使用这些结果。
第二步：如果 24 小时内不足 ${minItems} 条，扩大到过去 ${fallback} 天（72 小时）内检索。
  → 过去 72 小时内发布的重要行业新闻同样有价值，不要因为不是当天就拒绝。
第三步：如果 72 小时内仍不足 ${minItems} 条，进一步扩大到过去 ${extended} 天内检索重要的行业动态。
  → 过去一周内的 FDA 审批、重大融资、产品发布等仍是行业人士值得关注的重要信息。
只有在过去 ${extended} 天内仍找不到至少 ${minItems} 条带可验证 URL 的高质量 AI 医疗器械新闻时，才输出 NO_ENOUGH_NEWS。

优先收录类型（按重要性排序）：
- FDA AI/ML 医疗器械审批（510(k)、De Novo、PMA）
- AI 手术机器人产品发布或临床数据
- AI 医学影像与诊断设备审批或研究
- AI 可穿戴与远程患者监测设备动态
- AI 心血管与神经介入设备动态
- 重要 AI 医疗器械融资或并购（>2000 万美元或具有战略意义）
- AI SaMD（软件即医疗器械）监管动态

输出规则：
1. 返回 ${minItems}–${maxItems} 条高质量、真实新闻，每条占一行（目标 ${targetItems} 条，不足时只要达到 ${minItems} 条即可发送）。
2. 按时间新旧排序，越新的排在越前面。
3. 每行必须严格遵循以下竖线分隔格式（每个字段内不得出现竖线）：
   标题 | 一句话摘要 | 行业重要性 | 原文来源URL | CATEGORY
   其中：
   - 标题：简体中文标题（可在括号内附英文原标题或发布日期，如"[2025-05-05]"）
   - 一句话摘要：简体中文，一句话，信息密度高，适合医疗器械从业者阅读
   - 行业重要性：简体中文，说明该新闻对 AI 医疗器械行业的影响
   - 原文来源URL：保留原始 URL，不要翻译
   - CATEGORY 必须是以下之一（英文原文，不要翻译）：AI-MedDevice, Imaging-Diagnostics, Surgical-Robotics, Cardiovascular-Neuro, Wearables-RPM, Regulatory-FDA, Commercial-Industry
4. 仅使用真实、可验证的 URL，不要编造链接。
5. 只有当过去 ${extended} 天内仍找不到 ${minItems} 条带真实 URL 的高质量医疗器械 AI 新闻时，才输出：
   NO_ENOUGH_NEWS
   不要编造新闻内容。
6. 跳过：泛 AI 新闻、无器械产品的生物技术内容、低质量新闻稿。
7. 不要输出任何解释、标题或注脚，只输出竖线分隔的新闻行或 NO_ENOUGH_NEWS。

开始：`;
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
