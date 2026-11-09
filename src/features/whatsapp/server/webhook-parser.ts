import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  WhatsAppWebhookPayload,
  ParsedWhatsAppInboundMessage,
  ParsedWhatsAppStatusUpdate,
} from "../domain/types";

export interface VerifySignatureResult {
  valid: boolean;
  reason?: string;
}

export function verifyWhatsAppWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined
): VerifySignatureResult {
  if (!appSecret || appSecret.trim().length === 0) {
    // If appSecret not configured in environment, validation is skipped only in test/dev
    if (process.env.NODE_ENV === "production") {
      return { valid: false, reason: "WHATSAPP_APP_SECRET is not configured in production" };
    }
    return { valid: true };
  }

  if (!signatureHeader) {
    return { valid: false, reason: "Missing X-Hub-Signature-256 header" };
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return { valid: false, reason: "Malformed X-Hub-Signature-256 header (must start with sha256=)" };
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
  } catch (err: any) {
    return { valid: false, reason: `Signature verification failed: ${err?.message || err}` };
  }
}

export interface ParseWebhookResult {
  messages: ParsedWhatsAppInboundMessage[];
  statuses: ParsedWhatsAppStatusUpdate[];
}

export function parseWhatsAppWebhook(payload: WhatsAppWebhookPayload): ParseWebhookResult {
  const result: ParseWebhookResult = {
    messages: [],
    statuses: [],
  };

  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return result;
  }

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id || "";
      const displayPhoneNumber = value.metadata?.display_phone_number;

      // Extract Contacts mapping for sender names
      const contactMap = new Map<string, string>();
      if (Array.isArray(value.contacts)) {
        for (const contact of value.contacts) {
          if (contact.wa_id && contact.profile?.name) {
            contactMap.set(contact.wa_id, contact.profile.name);
          }
        }
      }

      // 1. Process Messages
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          const fromPhone = msg.from;
          const providerMessageId = msg.id;
          const timestamp = msg.timestamp
            ? new Date(parseInt(msg.timestamp, 10) * 1000)
            : new Date();

          let body = "";
          if (msg.type === "text" && msg.text?.body) {
            body = msg.text.body;
          } else if (msg.type === "interactive") {
            body =
              msg.interactive?.button_reply?.title ||
              msg.interactive?.list_reply?.title ||
              "[Interactive selection]";
          } else if (msg.type === "button") {
            body = (msg as any).button?.text || "[Button reply]";
          } else {
            body = `[${msg.type.toUpperCase()} message]`;
          }

          result.messages.push({
            providerMessageId,
            fromPhone,
            senderName: contactMap.get(fromPhone),
            phoneNumberId,
            displayPhoneNumber,
            body,
            timestamp,
            rawPayload: msg,
          });
        }
      }

      // 2. Process Status updates
      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          const timestamp = status.timestamp
            ? new Date(parseInt(status.timestamp, 10) * 1000)
            : new Date();

          const error = status.errors?.[0];

          result.statuses.push({
            providerMessageId: status.id,
            status: status.status,
            timestamp,
            recipientPhone: status.recipient_id,
            errorCode: error?.code,
            errorMessage: error?.message || error?.title,
            rawPayload: status,
          });
        }
      }
    }
  }

  return result;
}
