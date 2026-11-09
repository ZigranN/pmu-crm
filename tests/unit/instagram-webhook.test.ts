import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/webhooks/instagram/route";
import {
  verifyInstagramWebhookSignature,
  validateInstagramWebhookPayload,
  extractSafeInstagramEventSummary,
} from "@/features/instagram/server/webhook";

describe("Instagram Webhook Endpoint & Security", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. GET /api/webhooks/instagram - Meta Webhook Verification", () => {
    it("returns 200 and challenge as plain text when verify token matches", async () => {
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "secure_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=secure_verify_token_123&hub.challenge=test_challenge_98765"
      );

      const response = await GET(req);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/plain");

      const bodyText = await response.text();
      expect(bodyText).toBe("test_challenge_98765");
    });

    it("returns 403 when verify token does not match", async () => {
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "secure_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge_98765"
      );

      const response = await GET(req);
      expect(response.status).toBe(403);

      const json = await response.json();
      expect(json.error).toContain("Webhook verification failed");
    });

    it("returns 403 when hub.mode is not 'subscribe'", async () => {
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "secure_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/instagram?hub.mode=unsubscribe&hub.verify_token=secure_verify_token_123&hub.challenge=test_challenge_98765"
      );

      const response = await GET(req);
      expect(response.status).toBe(403);
    });

    it("returns 403 when INSTAGRAM_WEBHOOK_VERIFY_TOKEN is not configured", async () => {
      delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=secure_verify_token_123&hub.challenge=test_challenge_98765"
      );

      const response = await GET(req);
      expect(response.status).toBe(403);
    });

    it("returns 403 when query parameters are missing", async () => {
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "secure_verify_token_123";

      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram");

      const response = await GET(req);
      expect(response.status).toBe(403);
    });
  });

  describe("2. Signature Verification (HMAC-SHA256)", () => {
    const secret = "test_meta_app_secret_xyz123";

    it("accepts valid HMAC-SHA256 signature", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");
      const header = `sha256=${hmac}`;

      const result = verifyInstagramWebhookSignature(rawBody, header, secret);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects tampered signature", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });
      const header = "sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

      const result = verifyInstagramWebhookSignature(rawBody, header, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Invalid signature digest");
    });

    it("rejects signature length mismatch without throwing exception", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });
      const header = "sha256=1234";

      const result = verifyInstagramWebhookSignature(rawBody, header, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Signature length mismatch");
    });

    it("rejects missing signature header", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });

      const result = verifyInstagramWebhookSignature(rawBody, null, secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Missing X-Hub-Signature-256 header");
    });

    it("rejects malformed signature header", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });

      const result = verifyInstagramWebhookSignature(rawBody, "invalid_format", secret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Malformed X-Hub-Signature-256 header");
    });

    it("rejects when META_APP_SECRET is not configured", () => {
      const rawBody = JSON.stringify({ object: "instagram", entry: [] });

      const result = verifyInstagramWebhookSignature(rawBody, "sha256=1234", undefined);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("META_APP_SECRET is not configured");
    });
  });

  describe("3. Payload Validation & Sanitized Logging", () => {
    it("validates valid Instagram webhook structure", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "17841400000000000",
            time: 1710000000,
            messaging: [
              {
                sender: { id: "user_123" },
                recipient: { id: "ig_account_456" },
                timestamp: 1710000000,
                message: {
                  mid: "mid.12345:67890",
                  text: "SENSITIVE_MESSAGE_BODY_SHOULD_NOT_LEAK",
                },
              },
            ],
          },
        ],
      };

      const validation = validateInstagramWebhookPayload(payload);
      expect(validation.valid).toBe(true);
      expect(validation.data?.object).toBe("instagram");

      const summary = extractSafeInstagramEventSummary(validation.data!);
      expect(summary.object).toBe("instagram");
      expect(summary.entryCount).toBe(1);
      expect(summary.entries[0].id).toBe("17841400000000000");
      expect(summary.entries[0].messagingEvents[0].senderId).toBe("user_123");
      expect(summary.entries[0].messagingEvents[0].messageId).toBe("mid.12345:67890");

      const summaryStr = JSON.stringify(summary);
      expect(summaryStr).not.toContain("SENSITIVE_MESSAGE_BODY_SHOULD_NOT_LEAK");
    });

    it("rejects non-instagram webhook object", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [],
      };

      const validation = validateInstagramWebhookPayload(payload);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("Unsupported webhook object");
    });

    it("rejects payload missing 'entry' array", () => {
      const payload = {
        object: "instagram",
      };

      const validation = validateInstagramWebhookPayload(payload);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("Missing or invalid 'entry' array");
    });

    it("rejects null or non-object payloads", () => {
      expect(validateInstagramWebhookPayload(null).valid).toBe(false);
      expect(validateInstagramWebhookPayload("string").valid).toBe(false);
    });
  });

  describe("4. POST /api/webhooks/instagram - Inbound Event Processing", () => {
    const secret = "test_meta_app_secret_xyz123";

    it("returns 200 EVENT_RECEIVED when signature and payload are valid", async () => {
      process.env.META_APP_SECRET = secret;

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const payload = {
        object: "instagram",
        entry: [
          {
            id: "17841400000000000",
            time: 1710000000,
            messaging: [
              {
                sender: { id: "user_999" },
                recipient: { id: "ig_account_111" },
                timestamp: 1710000000,
                message: {
                  mid: "mid.abc123xyz",
                  text: "Hello, confidential query here",
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");

      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": `sha256=${hmac}`,
        },
        body: rawBody,
      });

      const response = await POST(req);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.status).toBe("EVENT_RECEIVED");
      expect(json.entryCount).toBe(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[Instagram Webhook] Event received:",
        expect.any(String)
      );

      const loggedOutput = consoleSpy.mock.calls[0]?.[1] as string;
      expect(loggedOutput).toContain("17841400000000000");
      expect(loggedOutput).toContain("mid.abc123xyz");
      expect(loggedOutput).not.toContain("Hello, confidential query here");
    });

    it("returns 401 when signature header is missing", async () => {
      process.env.META_APP_SECRET = secret;

      const rawBody = JSON.stringify({ object: "instagram", entry: [] });
      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: rawBody,
      });

      const response = await POST(req);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error).toContain("Missing X-Hub-Signature-256 header");
    });

    it("returns 401 when signature is invalid", async () => {
      process.env.META_APP_SECRET = secret;

      const rawBody = JSON.stringify({ object: "instagram", entry: [] });
      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=invalidhexsignature000000000000000000000000000000000000000000000000",
        },
        body: rawBody,
      });

      const response = await POST(req);
      expect(response.status).toBe(401);
    });

    it("returns 400 when body is not valid JSON", async () => {
      process.env.META_APP_SECRET = secret;

      const rawBody = "{ invalid_json: ";
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");

      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": `sha256=${hmac}`,
        },
        body: rawBody,
      });

      const response = await POST(req);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid JSON payload");
    });

    it("returns 400 when payload structure is invalid", async () => {
      process.env.META_APP_SECRET = secret;

      const rawBody = JSON.stringify({ object: "other_platform", entry: [] });
      const hmac = createHmac("sha256", secret).update(rawBody).digest("hex");

      const req = new NextRequest("http://localhost:3000/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": `sha256=${hmac}`,
        },
        body: rawBody,
      });

      const response = await POST(req);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toContain("Invalid webhook payload structure");
    });
  });
});
