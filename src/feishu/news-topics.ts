/**
 * News topic configuration for AI medical device industry daily digest.
 *
 * Seven broad categories covering AI applications across the full medical
 * device industry. Keywords are used in the OpenRouter prompt — expand
 * freely without touching runner.ts.
 */

export type NewsCategory =
  | "AI-MedDevice"
  | "Imaging-Diagnostics"
  | "Surgical-Robotics"
  | "Cardiovascular-Neuro"
  | "Wearables-RPM"
  | "Regulatory-FDA"
  | "Commercial-Industry"
  | "Neurointervention-Deals";

export const NEWS_TOPIC_KEYWORDS: Record<NewsCategory, string[]> = {
  "AI-MedDevice": [
    "AI medical device",
    "AI-powered medical device",
    "machine learning medical device",
    "AI SaMD software as medical device",
    "AI clinical decision support",
    "AI hospital connected device",
    "AI digital health device",
    "AI in medtech",
  ],
  "Imaging-Diagnostics": [
    "AI medical imaging",
    "AI radiology device",
    "AI pathology device",
    "AI dermatology screening device",
    "AI ophthalmology device",
    "AI cancer screening device",
    "AI endoscopy device",
    "AI colonoscopy detection",
    "AI mammography",
    "AI CT MRI analysis device",
  ],
  "Surgical-Robotics": [
    "AI surgical robot",
    "AI robotic surgery",
    "autonomous surgery AI device",
    "AI-guided surgical system",
    "AI orthopedic robot",
    "AI laparoscopic robot",
    "AI spine surgery robot",
    "AI surgical planning device",
  ],
  "Cardiovascular-Neuro": [
    "AI cardiovascular device",
    "AI heart failure monitoring device",
    "AI cardiac monitoring",
    "AI ECG device",
    "AI stroke detection device",
    "AI neurovascular device",
    "AI neurointervention",
    "AI stroke thrombectomy",
    "AI aneurysm detection",
    "AI atrial fibrillation device",
  ],
  "Wearables-RPM": [
    "AI wearable medical device",
    "AI remote patient monitoring device",
    "AI continuous glucose monitor",
    "AI insulin pump",
    "AI implantable device",
    "AI digital biomarker device",
    "AI biosensor medical",
    "AI patch monitor",
  ],
  "Regulatory-FDA": [
    "FDA AI medical device clearance",
    "FDA 510k AI approval",
    "FDA De Novo AI device",
    "CE mark AI medical device",
    "FDA AI/ML-enabled device",
    "AI device regulatory submission",
    "FDA predetermined change control plan",
    "FDA digital health center excellence",
  ],
  "Commercial-Industry": [
    "medtech AI funding round",
    "AI medical device acquisition",
    "AI medical device product launch",
    "medtech AI partnership",
    "AI medical device FDA cleared commercial",
    "AI hospital technology deal",
    "medtech AI startup investment",
  ],
  "Neurointervention-Deals": [
    "neurointervention funding",
    "neurovascular startup funding",
    "neurovascular acquisition",
    "neurovascular merger",
    "neurointerventional device investment",
    "stroke thrombectomy startup funding",
    "aneurysm device acquisition",
    "flow diverter company acquisition",
    "stent retriever company funding",
    "embolization device investment",
    "medtech M&A neurovascular",
    "strategic investment neurovascular device",
    "neurovascular device IPO",
    "neurovascular licensing deal",
    "neurovascular partnership",
    "Cerenovus acquisition",
    "Stryker Neurovascular acquisition",
    "Medtronic neurovascular investment",
    "Penumbra acquisition",
    "MicroVention investment",
    "Balt neurovascular funding",
    "Wallaby Medical financing",
    "Rapid Medical acquisition",
    "Imperative Care funding",
    "Synchron investment",
    "Route 92 Medical funding",
    "Q'Apel Medical funding",
    "Ceretrieve funding",
    "Vesalio funding",
  ],
};

export const DIGEST_CONFIG = {
  /** Ideal number of items per digest. */
  targetItems: 10,
  /** Maximum items — truncate if LLM returns more. */
  maxItems: 12,
  /** Minimum items before declaring fallback. */
  minItems: 3,
  /** Primary search window (hours). Try this first. */
  primaryLookbackDays: 1,
  /** First fallback window if primary yields < minItems. */
  fallbackLookbackDays: 3,
  /** Extended window if fallback still yields < minItems. */
  extendedLookbackDays: 7,
} as const;

/** Flat list of all keywords, used for prompt construction. */
export function allKeywords(): string {
  return Object.values(NEWS_TOPIC_KEYWORDS).flat().join(", ");
}
