/**
 * Format a news digest for Feishu text message.
 *
 * Feishu text messages support basic newlines and Unicode.
 * This formatter produces a readable plain-text digest suitable
 * for the `msg_type: "text"` payload — no complex card JSON required.
 */

import type { NewsCategory } from "./news-topics.js";

export type NewsItem = {
  title: string;
  summary: string;
  whyItMatters: string;
  url: string;
  category: NewsCategory;
};

const CATEGORY_EMOJI: Record<NewsCategory, string> = {
  "AI-MedDevice": "🤖",
  "Imaging-Diagnostics": "🔬",
  "Surgical-Robotics": "🦾",
  "Cardiovascular-Neuro": "🫀",
  "Wearables-RPM": "📡",
  "Regulatory-FDA": "📋",
  "Commercial-Industry": "💼",
};

/**
 * Format a single news item as a text block.
 */
function formatItem(item: NewsItem, index: number): string {
  const emoji = CATEGORY_EMOJI[item.category] ?? "📰";
  const lines = [
    `${index}. ${emoji} [${item.category}] ${item.title}`,
    `   摘要：${item.summary}`,
    `   重要性：${item.whyItMatters}`,
    `   来源：${item.url}`,
  ];
  return lines.join("\n");
}

/**
 * Build the full Feishu message text for a news digest.
 */
export function formatDigest(items: NewsItem[], dateLabel: string): string {
  const header = [
    `📋 AI 医疗器械行业 · 每日资讯`,
    `📅 ${dateLabel}`,
    `─────────────────────────`,
  ].join("\n");

  if (items.length === 0) {
    return [header, "", "今日无足够高质量更新，请明日再看。"].join("\n");
  }

  const body = items.map((item, i) => formatItem(item, i + 1)).join("\n\n");

  const footer = [
    "─────────────────────────",
    `共 ${items.length} 条 · 由 OpenRouter LLM 整理 · 仅供参考`,
  ].join("\n");

  return [header, "", body, "", footer].join("\n");
}

/**
 * Parse the structured LLM output (one item per line, pipe-delimited) into NewsItem[].
 *
 * Expected line format (produced by runner.ts prompt):
 *   TITLE | SUMMARY | WHY_IT_MATTERS | URL | CATEGORY
 *
 * Lines that do not match this format are skipped.
 * Returns an empty array if the LLM returned the NO_ENOUGH_NEWS sentinel.
 */
export function parseLLMOutput(raw: string): NewsItem[] {
  const trimmed = raw.trim();

  // Sentinel: LLM declared not enough quality news.
  // Accept any variant the model returns (NO_ENOUGH_NEWS, NOT_ENOUGH_NEWS, etc.)
  if (/\bno[t_-]*_?enough[_-]?news\b/i.test(trimmed) || /no sufficient/i.test(trimmed)) {
    return [];
  }

  const items: NewsItem[] = [];

  for (const line of trimmed.split("\n")) {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 5) {
      continue;
    }

    const [title, summary, whyItMatters, url, rawCategory] = parts;
    if (!title || !summary || !url) {
      continue;
    }

    // Normalise category — map LLM output to one of our seven NewsCategory values
    let category: NewsCategory = "AI-MedDevice";
    const cat = (rawCategory ?? "").toLowerCase().replace(/[\s_]/g, "-");
    if (
      cat.includes("imaging") ||
      cat.includes("diagnostic") ||
      cat.includes("radiology") ||
      cat.includes("pathology")
    ) {
      category = "Imaging-Diagnostics";
    } else if (cat.includes("surgical") || cat.includes("robot") || cat.includes("surgery")) {
      category = "Surgical-Robotics";
    } else if (
      cat.includes("cardio") ||
      cat.includes("neuro") ||
      cat.includes("stroke") ||
      cat.includes("cardiac")
    ) {
      category = "Cardiovascular-Neuro";
    } else if (
      cat.includes("wearable") ||
      cat.includes("rpm") ||
      cat.includes("remote") ||
      cat.includes("monitor") ||
      cat.includes("glucose")
    ) {
      category = "Wearables-RPM";
    } else if (
      cat.includes("regulat") ||
      cat.includes("fda") ||
      cat.includes("510k") ||
      cat.includes("clearance") ||
      cat.includes("ce-mark")
    ) {
      category = "Regulatory-FDA";
    } else if (
      cat.includes("commercial") ||
      cat.includes("industry") ||
      cat.includes("funding") ||
      cat.includes("launch") ||
      cat.includes("acquisition")
    ) {
      category = "Commercial-Industry";
    }

    items.push({
      title,
      summary: summary ?? "",
      whyItMatters: whyItMatters ?? "",
      url,
      category,
    });
  }

  return items;
}
