/**
 * Feishu (Lark) custom bot webhook sender.
 *
 * Supports HMAC-SHA256 signed requests per Feishu spec:
 *   https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 *
 * Required env: FEISHU_WEBHOOK_URL
 * Optional env: FEISHU_WEBHOOK_SECRET (enables signature)
 *
 * CLI usage:
 *   bun src/feishu/send.ts --test
 */

import crypto from "node:crypto";
import { request } from "undici";

export type FeishuTextPayload = {
  msg_type: "text";
  content: { text: string };
  timestamp?: string;
  sign?: string;
};

/**
 * Feishu HMAC-SHA256 signing.
 * Per Feishu spec: HMAC key = "${timestamp}\n${secret}", data = "" (empty string).
 */
function buildSign(secret: string, timestamp: number): string {
  const key = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", key).update("").digest("base64");
}

/**
 * Send a text message to a Feishu webhook.
 * Throws on non-2xx HTTP status or Feishu error code != 0.
 */
export async function sendFeishuText(text: string): Promise<void> {
  const url = process.env.FEISHU_WEBHOOK_URL;
  if (!url) {
    throw new Error("FEISHU_WEBHOOK_URL is not set");
  }

  const secret = process.env.FEISHU_WEBHOOK_SECRET?.trim() || undefined;

  const payload: FeishuTextPayload = {
    msg_type: "text",
    content: { text },
  };

  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = buildSign(secret, timestamp);
  }

  const resp = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const bodyText = await resp.body.text();

  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`Feishu webhook HTTP ${resp.statusCode}: ${bodyText}`);
  }

  let parsed: { code?: number; msg?: string } = {};
  try {
    parsed = JSON.parse(bodyText) as { code?: number; msg?: string };
  } catch {
    // ignore parse failure — some webhooks return plain text
  }

  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new Error(`Feishu webhook error code=${parsed.code} msg=${parsed.msg ?? ""}`);
  }
}

// --- CLI entry point ---
if (process.argv[1] && process.argv[1].endsWith("send.ts") && process.argv.includes("--test")) {
  const ts = new Date().toISOString();
  const testMsg = `✅ Feishu webhook integration test OK\nTimestamp: ${ts}\nThis is a test message from feishu/send.ts --test`;
  console.log("Sending test message to Feishu...");
  sendFeishuText(testMsg)
    .then(() => {
      console.log("✅ Test message sent successfully.");
    })
    .catch((err: unknown) => {
      console.error("❌ Failed to send test message:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
