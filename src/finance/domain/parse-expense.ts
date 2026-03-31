/**
 * Finance expense parser — domain layer.
 * Pure function — no I/O, no LLM, no side effects.
 * Extracts structured fields from a natural-language expense description.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpenseDraft {
  // Core Fields (always present; "unknown" when not extractable)
  date: string;
  amount: string;
  currency: string;
  category: string;
  paymentMethod: string;
  paidBy: string;
  businessPurpose: string;
  reimbursable: string;
  notes: string;

  // Extended Fields (optional; "unknown" when not extractable)
  company: string;
  projectTag: string;
  receipt: string;
  invoice: string;
  assetType: string;
  depreciable: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise text for matching: lowercase, collapse whitespace. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Amount & Currency
// ---------------------------------------------------------------------------

interface AmountResult {
  amount: string;
  currency: string;
}

function extractAmountAndCurrency(text: string): AmountResult {
  // "$1,942.42" or "$20"
  const dollarSign = /\$\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (dollarSign) {
    return { amount: dollarSign[1].replace(/,/g, ""), currency: "USD" };
  }

  // "20 dollars" / "20 USD" / "48 usd"
  const wordAmount = /([\d,]+(?:\.\d+)?)\s*(dollars?|usd)\b/i.exec(text);
  if (wordAmount) {
    return { amount: wordAmount[1].replace(/,/g, ""), currency: "USD" };
  }

  // CNY / RMB
  const cny = /([\d,]+(?:\.\d+)?)\s*(rmb|cny|yuan|元)\b/i.exec(text);
  if (cny) {
    return { amount: cny[1].replace(/,/g, ""), currency: "CNY" };
  }

  // GBP
  const gbp = /£\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (gbp) {
    return { amount: gbp[1].replace(/,/g, ""), currency: "GBP" };
  }

  // EUR
  const eur = /€\s*([\d,]+(?:\.\d+)?)/i.exec(text);
  if (eur) {
    return { amount: eur[1].replace(/,/g, ""), currency: "EUR" };
  }

  // bare number as last resort (e.g. "花了 200")
  const bareNum = /\b([\d,]+(?:\.\d+)?)\b/.exec(text);
  if (bareNum) {
    return { amount: bareNum[1].replace(/,/g, ""), currency: "USD" };
  }

  return { amount: "unknown", currency: "unknown" };
}

// ---------------------------------------------------------------------------
// Date  (output: ISO yyyy-mm-dd or "unknown")
// ---------------------------------------------------------------------------

function extractDate(text: string): string {
  const n = norm(text);
  const today = new Date();

  if (/\byesterday\b|昨天/.test(n)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return toISO(d);
  }
  if (/\btoday\b|今天/.test(n)) {
    return toISO(today);
  }

  // yyyy-mm-dd or yyyy/mm/dd
  const isoMatch = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // mm/dd/yyyy or mm-dd-yyyy
  const mdyMatch = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/.exec(text);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // "March 15" / "15 March" with optional year
  const monthNames =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
  const namedMonthFull =
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(\d{4})?\b/i.exec(
      text,
    );
  if (namedMonthFull) {
    const day = namedMonthFull[1];
    const mon = parseMonthName(namedMonthFull[2]);
    const year = namedMonthFull[3] ?? String(today.getFullYear());
    return `${year}-${mon}-${day.padStart(2, "0")}`;
  }

  const namedMonthDayYear =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s*,?\s*(\d{4})?\b/i.exec(
      text,
    );
  if (namedMonthDayYear) {
    const mon = parseMonthName(namedMonthDayYear[1]);
    const day = namedMonthDayYear[2];
    const year = namedMonthDayYear[3] ?? String(today.getFullYear());
    return `${year}-${mon}-${day.padStart(2, "0")}`;
  }

  void monthNames; // referenced for type-checking only
  return "unknown";
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseMonthName(name: string): string {
  const map: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  };
  return map[name.toLowerCase()] ?? "01";
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

function extractCategory(text: string): string {
  const n = norm(text);
  if (/\b(software|subscription|saas|app|license|claude|cursor|api|addon)\b/.test(n)) {
    return "Software";
  }
  if (
    /\b(laptop|macbook|computer|device|monitor|keyboard|equipment|hardware|ipad|tablet)\b/.test(n)
  ) {
    return "Equipment";
  }
  if (/\b(meal|lunch|dinner|breakfast|coffee|food|restaurant|cafe|dining|drink)\b/.test(n)) {
    return "Meals";
  }
  if (/\b(travel|flight|hotel|accommodation|uber|taxi|transport|train|airbnb)\b/.test(n)) {
    return "Travel";
  }
  if (/\b(office|stationery|supply|supplies)\b/.test(n)) {
    return "Office Supplies";
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Payment Method (standardised)
// ---------------------------------------------------------------------------

function extractPaymentMethod(text: string): string {
  const n = norm(text);
  if (/\b(personal\s+credit|personal\s+card)\b|个人卡|个人信用卡/.test(n)) {
    return "Personal Credit Card";
  }
  if (/\b(company\s+credit|corporate\s+card|company\s+card)\b|公司卡|公司信用卡/.test(n)) {
    return "Company Credit Card";
  }
  if (/\b(credit\s+card|credit)\b|信用卡/.test(n)) {
    return "Credit Card";
  }
  if (/\b(debit\s+card|debit)\b|借记卡/.test(n)) {
    return "Debit Card";
  }
  if (/\balipay\b|支付宝/.test(n)) {
    return "Alipay";
  }
  if (/\bwechat\s*pay\b|微信支付|微信/.test(n)) {
    return "WeChat Pay";
  }
  if (/\bpaypal\b/.test(n)) {
    return "PayPal";
  }
  if (/\bcash\b|现金/.test(n)) {
    return "Cash";
  }
  if (/\bbank\s+transfer\b|转账/.test(n)) {
    return "Bank Transfer";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Paid By
// ---------------------------------------------------------------------------

function extractPaidBy(text: string): string {
  const n = norm(text);
  // CJK terms don't use \b word boundaries
  if (/个人|自己/.test(n) || /\b(personal|myself|self)\b/.test(n)) {
    return "Personal";
  }
  if (/公司/.test(n) || /\b(company|corporate|employer)\b/.test(n)) {
    return "Company";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Business Purpose
// ---------------------------------------------------------------------------

function extractBusinessPurpose(text: string): string {
  // Chinese: 用于… (checked first — most explicit)
  const zhMatch = /用于\s*([^，。；\n]+)/u.exec(text);
  if (zhMatch) {
    return zhMatch[1].trim();
  }

  // English: collect all "for <phrase>" clauses, skip amount fragments,
  // prefer the last non-trivial match (avoids "for $1942.42").
  const forRe = /\bfor\s+([^,.;]+)/gi;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = forRe.exec(text)) !== null) {
    const candidate = m[1].trim();
    // Skip fragments starting with $ or digits (amount refs)
    if (/^\$|^\d/.test(candidate)) {
      continue;
    }
    // Skip very short fragments ("for a")
    if (candidate.length <= 2) {
      continue;
    }
    best = candidate;
  }
  if (best != null) {
    return capitalise(best);
  }

  return "unknown";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Reimbursable
// ---------------------------------------------------------------------------

function extractReimbursable(text: string): string {
  const n = norm(text);
  if (/\b(reimbursement|reimbursable|company|client|business|work|报销)\b/.test(n)) {
    return "Yes";
  }
  return "Unknown";
}

// ---------------------------------------------------------------------------
// Notes (truncated raw text as fallback context)
// ---------------------------------------------------------------------------

function buildNotes(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? trimmed.slice(0, 117) + "..." : trimmed;
}

// ---------------------------------------------------------------------------
// Extended Fields
// ---------------------------------------------------------------------------

function extractProjectTag(text: string): string {
  const n = norm(text);
  if (/\b(ai|machine\s*learning|ml|llm|gpt|claude|openai|artificial)\b/.test(n)) {
    return "AI Infrastructure";
  }
  if (/\b(infra|infrastructure|server|cloud|aws|gcp|azure)\b/.test(n)) {
    return "Infrastructure";
  }
  if (/\b(marketing|ads|advertising|campaign)\b/.test(n)) {
    return "Marketing";
  }
  if (/\b(hr|hiring|recruit|onboard)\b/.test(n)) {
    return "HR";
  }
  return "unknown";
}

function extractReceipt(text: string): string {
  const n = norm(text);
  if (/\b(receipt|领取|收据)\b/.test(n)) {
    return "Yes";
  }
  return "Unknown";
}

function extractInvoice(text: string): string {
  const n = norm(text);
  if (/\b(invoice|发票)\b/.test(n)) {
    return "Yes";
  }
  return "Unknown";
}

function extractAssetType(text: string): string {
  const n = norm(text);
  if (/\b(laptop|macbook|computer|device|monitor|keyboard|ipad|tablet|hardware)\b/.test(n)) {
    return "Equipment";
  }
  if (/\b(software|subscription|saas|app|license|claude|cursor|api)\b/.test(n)) {
    return "Software";
  }
  if (/\b(service|consulting|support|maintenance)\b/.test(n)) {
    return "Service";
  }
  return "unknown";
}

function extractDepreciable(assetType: string): string {
  if (assetType === "Equipment") {
    return "true";
  }
  if (assetType === "Software") {
    return "false";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function parseExpense(text: string): ExpenseDraft {
  const { amount, currency } = extractAmountAndCurrency(text);
  const assetType = extractAssetType(text);

  return {
    date: extractDate(text),
    amount,
    currency,
    category: extractCategory(text),
    paymentMethod: extractPaymentMethod(text),
    paidBy: extractPaidBy(text),
    businessPurpose: extractBusinessPurpose(text),
    reimbursable: extractReimbursable(text),
    notes: buildNotes(text),

    company: "Ainetrix Inc",
    projectTag: extractProjectTag(text),
    receipt: extractReceipt(text),
    invoice: extractInvoice(text),
    assetType,
    depreciable: extractDepreciable(assetType),
  };
}
