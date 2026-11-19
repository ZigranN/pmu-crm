import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/webhooks/whatsapp/route";
import {
  verifyWhatsAppWebhookSignature,
} from "@/features/whatsapp/server/webhook-parser";
import {
  generateWhatsAppConsultationDraft,
} from "@/features/whatsapp/server/orchestrator";

vi.mock("@/features/whatsapp/server/orchestrator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/whatsapp/server/orchestrator")>();
  return {
    ...actual,
    processInboundWhatsAppMessage: vi.fn().mockResolvedValue({
      handled: true,
      scenario: "SCENARIO_A_CONSULTATION",
      studioId: "studio_mock_1",
      clientId: "client_mock_1",
      conversationId: "conv_mock_1",
      inboundMessageId: "msg_mock_1",
      reason: "Inbound consultation message recorded; outbound auto-reply disabled by default for MVP safety.",
    }),
  };
});

describe("WhatsApp Webhook Endpoint & Inbound Processing Safety", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. GET /api/webhooks/whatsapp - Meta Verification Challenge", () => {
    it("returns 200 with challenge token when verify token matches", async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "test_wa_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test_wa_verify_token_123&hub.challenge=test_challenge_abc"
      );

      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(await res.text()).toBe("test_challenge_abc");
    });

    it("returns 403 when verify token is incorrect", async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "test_wa_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge_abc"
      );

      const res = await GET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Webhook verification failed");
    });

    it("returns 403 when hub.mode is not 'subscribe'", async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "test_wa_verify_token_123";

      const req = new NextRequest(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=test_wa_verify_token_123&hub.challenge=test_challenge_abc"
      );

      const res = await GET(req);
      expect(res.status).toBe(403);
    });
  });

  describe("2. HMAC-SHA256 Webhook Signature Verification", () => {
    const appSecret = "meta_app_secret_xyz789";

    it("validates correct x-hub-signature-256 header", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      const hmac = createHmac("sha256", appSecret).update(payload).digest("hex");
      const signature = `sha256=${hmac}`;

      const check = verifyWhatsAppWebhookSignature(payload, signature, appSecret);
      expect(check.valid).toBe(true);
      expect(check.reason).toBeUndefined();
    });

    it("rejects tampered signature header", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      const badSignature = "sha256=1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff";

      const check = verifyWhatsAppWebhookSignature(payload, badSignature, appSecret);
      expect(check.valid).toBe(false);
      expect(check.reason).toBe("Invalid signature digest");
    });

    it("rejects missing signature header when secret is configured", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

      const check = verifyWhatsAppWebhookSignature(payload, null, appSecret);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain("Missing X-Hub-Signature-256");
    });
  });

  describe("3. POST /api/webhooks/whatsapp - Inbound Webhook Execution Safety", () => {
    const appSecret = "meta_secret_for_post";

    it("returns 401 on invalid signature", async () => {
      process.env.WHATSAPP_APP_SECRET = appSecret;

      const req = new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "x-hub-signature-256": "sha256=bad_digest",
          "content-type": "application/json",
        },
        body: JSON.stringify({ object: "whatsapp_business_account" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("Unauthorized webhook signature");
    });

    it("parses valid payload and triggers orchestrator without throwing or failing webhook delivery", async () => {
      process.env.WHATSAPP_APP_SECRET = appSecret;

      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "wa_biz_1",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "+393331234567",
                    phone_number_id: "phone_1001",
                  },
                  contacts: [{ profile: { name: "Test Client" }, wa_id: "393339999999" }],
                  messages: [
                    {
                      from: "393339999999",
                      id: "wamid.unit.test.1",
                      timestamp: "1720000000",
                      text: { body: "Здравствуйте! Хочу записаться на брови." },
                      type: "text",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const hmac = createHmac("sha256", appSecret).update(rawBody).digest("hex");

      const req = new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "x-hub-signature-256": `sha256=${hmac}`,
          "content-type": "application/json",
        },
        body: rawBody,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("EVENT_RECEIVED");
      expect(json.processedMessages).toBe(1);
    });
  });

  describe("4. Advisory Consultation Draft Generation", () => {
    it("generates deterministic knowledge base drafts safely without sending messages", async () => {
      const draftBrows = await generateWhatsAppConsultationDraft("Расскажите про подготовку к бровям");
      expect(draftBrows).toContain("Подготовка к перманентному макияжу бровей");

      const draftLips = await generateWhatsAppConsultationDraft("Как подготовиться к перманенту губ?");
      expect(draftLips).toContain("Подготовка к перманентному макияжу губ");

      const draftAftercare = await generateWhatsAppConsultationDraft("Какой уход после процедуры?");
      expect(draftAftercare).toContain("Уход после процедуры");
    });
  });
});
