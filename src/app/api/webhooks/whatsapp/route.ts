import { NextRequest, NextResponse } from "next/server";
import {
  verifyWhatsAppWebhookSignature,
  parseWhatsAppWebhook,
} from "@/features/whatsapp/server/webhook-parser";
import { processInboundWhatsAppMessage } from "@/features/whatsapp/server/orchestrator";
import type { WhatsAppWebhookPayload } from "@/features/whatsapp/domain/types";

export const runtime = "nodejs";

/**
 * GET /api/webhooks/whatsapp
 * Meta WhatsApp Cloud API Webhook Verification Challenge.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken =
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    "pmu_whatsapp_verify_token";

  if (mode === "subscribe" && token === expectedToken) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json(
    { error: "Webhook verification failed: invalid mode or verify token" },
    { status: 403 }
  );
}

/**
 * POST /api/webhooks/whatsapp
 * Inbound Webhook Event Processor for Meta WhatsApp Cloud API.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Cannot read request body" }, { status: 400 });
  }

  // 1. Verify webhook signature
  const sigCheck = verifyWhatsAppWebhookSignature(rawBody, signature, appSecret);
  if (!sigCheck.valid) {
    return NextResponse.json(
      { error: `Unauthorized webhook signature: ${sigCheck.reason}` },
      { status: 401 }
    );
  }

  // 2. Parse JSON payload
  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = parseWhatsAppWebhook(payload);

  // 3. Process inbound messages asynchronously/synchronously within serverless lifecycle
  const results = [];
  for (const msg of parsed.messages) {
    try {
      const res = await processInboundWhatsAppMessage(msg);
      results.push(res);
    } catch (err: any) {
      // Log error but do not fail the webhook delivery to prevent Meta retry loops
      console.error("[WhatsApp Webhook] Error processing message:", err);
      results.push({
        handled: false,
        reason: err?.message || String(err),
      });
    }
  }

  // Meta expects HTTP 200 within 20s
  return NextResponse.json({
    status: "EVENT_RECEIVED",
    processedMessages: results.length,
    processedStatuses: parsed.statuses.length,
    results,
  });
}
