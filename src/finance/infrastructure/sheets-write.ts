/**
 * Google Sheets read/write for the finance ledger — infrastructure layer.
 *
 * Required environment variables (set outside the repo — never commit values):
 *   GOOGLE_CLIENT_EMAIL   — service account email
 *   GOOGLE_PRIVATE_KEY    — private key string (literal \n sequences are normalised here)
 *   GOOGLE_SHEETS_ID      — target spreadsheet ID
 *
 * Sheet layout:
 *   Row 1 = header row (skipped when counting existing records)
 *   Columns A–T = the 20 expense fields in draft-to-row.ts order
 *
 * Deployment note: share the spreadsheet with the service account email
 * (Editor role) before first use.
 */

import fs from "node:fs";
import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Auth — built once per process
// ---------------------------------------------------------------------------

/**
 * Normalise GOOGLE_PRIVATE_KEY.
 * When set via docker / shell env the literal string "\n" must become real newlines.
 * This is the single place that transformation happens.
 */
function resolvePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

/**
 * Load credentials from GOOGLE_SHEETS_CREDENTIALS_FILE (service account JSON)
 * when GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY env vars are not set directly.
 */
function loadCredsFromFile(): { clientEmail?: string; privateKey?: string } {
  const credFile = process.env.GOOGLE_SHEETS_CREDENTIALS_FILE;
  if (!credFile) {
    return {};
  }
  try {
    const raw = JSON.parse(fs.readFileSync(credFile, "utf8")) as {
      client_email?: string;
      private_key?: string;
    };
    return { clientEmail: raw.client_email, privateKey: raw.private_key };
  } catch {
    return {};
  }
}

function buildAuth() {
  let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;

  // Fallback: load from service account JSON file if env vars not set directly.
  if (!clientEmail || !privateKeyRaw) {
    const fileCreds = loadCredsFromFile();
    clientEmail ??= fileCreds.clientEmail;
    privateKeyRaw ??= fileCreds.privateKey;
  }

  if (!clientEmail || !privateKeyRaw) {
    throw new Error(
      "Google Sheets credentials missing: set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY",
    );
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: resolvePrivateKey(privateKeyRaw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetId(): string {
  // Support both GOOGLE_SHEETS_ID (code convention) and GOOGLE_SPREADSHEET_ID (BotSpec convention).
  const id = process.env.GOOGLE_SHEETS_ID ?? process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) {
    throw new Error("Google Sheets target missing: set GOOGLE_SHEETS_ID");
  }
  return id;
}

// ---------------------------------------------------------------------------
// Read existing Expense IDs (column A, rows 2+)
// ---------------------------------------------------------------------------

/**
 * Returns all non-empty values from column A of the sheet (excluding header).
 * Used by expense-id.ts to determine the next EXP-YYYY-NNN.
 */
export async function readExpenseIds(): Promise<string[]> {
  const auth = buildAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "A2:A", // column A, skip header
  });

  const rows = response.data.values ?? [];
  return rows.map((row) => (row[0] as string | undefined) ?? "").filter((v) => v.length > 0);
}

// ---------------------------------------------------------------------------
// Append a row
// ---------------------------------------------------------------------------

/**
 * Appends a single row (20 columns) to the first empty row of the sheet.
 */
export async function appendExpenseRow(row: string[]): Promise<void> {
  const auth = buildAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A:T",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}
