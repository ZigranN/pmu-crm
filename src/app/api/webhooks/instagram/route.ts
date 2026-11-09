import { NextRequest, NextResponse } from "next/server";
import {
  verifyInstagramWebhookSignature,
  validateInstagramWebhookPayload,
  extractSafeInstagramEventSummary,
} from "@/features/instagram/server/webhook";

export const runtime = "nodejs";

/**
 * GET /api/webhooks/instagram
 * Meta Instagram Webhook Verification Challenge.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    expectedToken &&
    expectedToken.trim().length > 0 &&
    token === expectedToken
  ) {
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
 * POST /api/webhooks/instagram
 * Inbound Webhook Event Receiver for Meta Instagram Graph API.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.META_APP_SECRET;

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Cannot read request body" },
      { status: 400 }
    );
  }

  // 1. Verify webhook signature using HMAC-SHA256 and META_APP_SECRET
  const sigCheck = verifyInstagramWebhookSignature(rawBody, signature, appSecret);
  if (!sigCheck.valid) {
    return NextResponse.json(
      { error: `Unauthorized webhook signature: ${sigCheck.reason}` },
      { status: 401 }
    );
  }

  // 2. Parse JSON payload
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // 3. Validate basic event structure
  const validation = validateInstagramWebhookPayload(parsedJson);
  if (!validation.valid || !validation.data) {
    return NextResponse.json(
      { error: `Invalid webhook payload structure: ${validation.error}` },
      { status: 400 }
    );
  }

  // 4. Safe logging without message bodies or credentials
  const safeSummary = extractSafeInstagramEventSummary(validation.data);
  console.log("[Instagram Webhook] Event received:", JSON.stringify(safeSummary));

  // Acknowledge receipt to Meta immediately (200 OK) without side effects
  return NextResponse.json({
    status: "EVENT_RECEIVED",
    entryCount: safeSummary.entryCount,
  });
}
