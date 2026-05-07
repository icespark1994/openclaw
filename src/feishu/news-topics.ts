/**
 * News topic configuration for AI-medtech daily digest.
 *
 * Organised into three categories that map to the output tag field.
 * Keywords are used in the OpenRouter prompt — expand freely without
 * touching runner.ts.
 */

export type NewsCategory = "AI" | "Neurointervention" | "AI+MedDevice";

export const NEWS_TOPIC_KEYWORDS: Record<NewsCategory, string[]> = {
  AI: [
    "AI healthcare",
    "medical AI",
    "healthcare AI regulation",
    "LLM clinical",
    "AI agent medical",
    "AI hospital",
    "clinical decision support AI",
    "FDA AI medical device",
    "artificial intelligence drug discovery",
    "AI diagnostics",
    "AI radiology",
    "large language model healthcare",
  ],
  Neurointervention: [
    "neurointervention",
    "neurovascular device",
    "stroke thrombectomy",
    "aneurysm coil",
    "flow diverter",
    "stent retriever",
    "aspiration catheter",
    "intracranial stent",
    "neurovascular FDA clearance",
    "mechanical thrombectomy",
    "Pipeline embolization",
    "Woven EndoBridge",
    "Penumbra thrombectomy",
    "Medtronic neurovascular",
    "Stryker neurovascular",
  ],
  "AI+MedDevice": [
    "AI medical device FDA",
    "AI neurovascular",
    "510k AI",
    "de novo AI medical",
    "AI-powered catheter",
    "machine learning neurovascular",
    "AI stroke detection",
    "computational neurovascular",
    "digital pathology AI FDA",
  ],
};

export const DIGEST_CONFIG = {
  /** Ideal number of items per digest. */
  targetItems: 10,
  /** Maximum items — truncate if LLM returns more. */
  maxItems: 12,
  /** Minimum before declaring "no enough quality news today". */
  minItems: 3,
  /** How far back to look (days). */
  lookbackDays: 1,
} as const;

/** Flat list of all keywords, used for prompt construction. */
export function allKeywords(): string {
  return Object.values(NEWS_TOPIC_KEYWORDS).flat().join(", ");
}
