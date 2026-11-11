import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  InstagramWebhookPayload,
} from "../domain/types";

export interface VerifySignatureResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates Meta's X-Hub-Signature-256 header using META_APP_SECRET and HMAC-SHA256.
 */
export function verifyInstagramWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined
): VerifySignatureResult {
  if (!appSecret || appSecret.trim().length === 0) {
    return { valid: false, reason: "META_APP_SECRET is not configured" };
  }

  if (!signatureHeader) {
    return { valid: false, reason: "Missing X-Hub-Signature-256 header" };
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return {
      valid: false,
      reason: "Malformed X-Hub-Signature-256 header (must start with sha256=)",
    };
  }

  const expectedSignatureHex = parts[1];
  const hmac = createHmac("sha256", appSecret);
  hmac.update(rawBody);
  const calculatedSignatureHex = hmac.digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedSignatureHex, "hex");
    const calculatedBuf = Buffer.from(calculatedSignatureHex, "hex");

    if (expectedBuf.length !== calculatedBuf.length) {
      return { valid: false, reason: "Signature length mismatch" };
    }

    const isValid = timingSafeEqual(expectedBuf, calculatedBuf);
    return {
      valid: isValid,
      reason: isValid ? undefined : "Invalid signature digest",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Signature verification failed: ${message}` };
  }
}

/**
 * Validates the basic structural integrity of an incoming Instagram webhook payload.
 */
export function validateInstagramWebhookPayload(
  payload: unknown
): { valid: boolean; error?: string; data?: InstagramWebhookPayload } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Payload must be a non-null object" };
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.object !== "string" || candidate.object.trim().length === 0) {
    return { valid: false, error: "Missing or invalid 'object' field" };
  }

  if (candidate.object !== "instagram") {
    return {
      valid: false,
      error: `Unsupported webhook object '${candidate.object}' (expected 'instagram')`,
    };
  }

  if (!Array.isArray(candidate.entry)) {
    return { valid: false, error: "Missing or invalid 'entry' array" };
  }

  return {
    valid: true,
    data: candidate as unknown as InstagramWebhookPayload,
  };
}

/**
 * Extracts a sanitized, privacy-preserving event summary suitable for audit logging.
 * Strips all user-generated message texts, captions, and secret parameters.
 */
export function extractSafeInstagramEventSummary(payload: InstagramWebhookPayload) {
  return {
    object: payload.object,
    entryCount: payload.entry.length,
    entries: payload.entry.map((entry) => ({
      id: entry.id,
      time: entry.time,
      changedFields: Array.isArray(entry.changes)
        ? entry.changes.map((c) => c.field)
        : [],
      messagingEvents: Array.isArray(entry.messaging)
        ? entry.messaging.map((m) => ({
            senderId: m.sender?.id,
            recipientId: m.recipient?.id,
            timestamp: m.timestamp,
            messageId: m.message?.mid,
            isEcho: m.message?.is_echo,
            hasAttachments: Array.isArray(m.message?.attachments) && m.message.attachments.length > 0,
            hasReaction: Boolean(m.reaction),
            hasRead: Boolean(m.read),
            hasPostback: Boolean(m.postback),
          }))
        : [],
    })),
  };
}
