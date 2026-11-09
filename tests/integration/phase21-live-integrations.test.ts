import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  MetaWhatsAppCloudApiClient,
  MockWhatsAppCloudApiClient,
  setWhatsAppClient,
} from "@/features/whatsapp/server/client";
import {
  verifyWhatsAppWebhookSignature,
} from "@/features/whatsapp/server/webhook-parser";
import {
  processInboundWhatsAppMessage,
} from "@/features/whatsapp/server/orchestrator";
import { ProductionAiAdapter } from "@/features/ai/providers/production-adapter";
import { checkActionProhibitions } from "@/features/ai/domain/guardrails";
import { GoogleCalendarApiClient } from "@/features/google-calendar/server/client";

describe("Phase 21.1: Live API Integrations & Real-World E2E Scenarios", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let studioAId: string;
  let studioBId: string;
  let ownerUserId: string;
  let mockWaClient: MockWhatsAppCloudApiClient;

  let STUDIO_A_WA_NUMBER: string;
  let STUDIO_B_WA_NUMBER: string;
  let TEST_CLIENT_PHONE: string;

  beforeAll(async () => {
    STUDIO_A_WA_NUMBER = `+3933${Math.floor(10000000 + Math.random() * 90000000)}`;
    STUDIO_B_WA_NUMBER = `+3933${Math.floor(10000000 + Math.random() * 90000000)}`;
    TEST_CLIENT_PHONE = `+3934${Math.floor(10000000 + Math.random() * 90000000)}`;

    database = await createTestDatabase();
    const db = database.db;

    mockWaClient = new MockWhatsAppCloudApiClient();
    setWhatsAppClient(mockWaClient);

    ownerUserId = randomUUID();
    await db.insert(s.user).values({
      id: ownerUserId,
      name: "Studio Owner",
      email: `${ownerUserId}@example.test`,
      role: "SUPER_ADMIN",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));

    // Create Studio A with dedicated WhatsApp number
    [studioAId] = (
      await db
        .insert(s.studios)
        .values({
          ...studioFixture(),
          name: "Studio Milano PMU",
          slug: `studio-a-${randomUUID().slice(0, 8)}`,
          whatsappNumber: STUDIO_A_WA_NUMBER,
          phone: STUDIO_A_WA_NUMBER,
        })
        .returning()
    ).map((r) => r.id);

    // Create Studio B with dedicated WhatsApp number
    [studioBId] = (
      await db
        .insert(s.studios)
        .values({
          ...studioFixture(),
          name: "Studio Roma PMU",
          slug: `studio-b-${randomUUID().slice(0, 8)}`,
          whatsappNumber: STUDIO_B_WA_NUMBER,
          phone: STUDIO_B_WA_NUMBER,
        })
        .returning()
    ).map((r) => r.id);

    await db.insert(s.studioMembers).values([
      { userId: ownerUserId, studioId: studioAId, roleId: role.id, isActive: true },
      { userId: ownerUserId, studioId: studioBId, roleId: role.id, isActive: true },
    ]);

    // Create master in Studio A
    await db.insert(s.masters).values({
      studioId: studioAId,
      displayName: "Анна Мастер",
      isActive: true,
    });
  });

  beforeEach(() => {
    mockWaClient.clear();
  });

  describe("1. WhatsApp Cloud API Webhook Signature & Security Validation", () => {
    const appSecret = "test_meta_app_secret_1234567890";

    it("verifies valid HMAC-SHA256 signature correctly", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      const hmac = createHmac("sha256", appSecret);
      hmac.update(payload);
      const validHeader = `sha256=${hmac.digest("hex")}`;

      const result = verifyWhatsAppWebhookSignature(payload, validHeader, appSecret);
      expect(result.valid).toBe(true);
    });

    it("rejects invalid or tampered HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      const invalidHeader = `sha256=abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890`;

      const result = verifyWhatsAppWebhookSignature(payload, invalidHeader, appSecret);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Invalid signature digest");
    });

    it("rejects missing signature header when secret is configured", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account" });
      const result = verifyWhatsAppWebhookSignature(payload, null, appSecret);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Missing X-Hub-Signature-256");
    });
  });

  describe("2. WhatsApp Cloud API Client Contract & 24-hour Service Window", () => {
    it("evaluates 24-hour service window correctly", () => {
      const client = new MetaWhatsAppCloudApiClient();

      // Case 1: Inbound message received 2 hours ago -> within 24h window
      const recentInbound = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const statusRecent = client.checkServiceWindow(recentInbound);
      expect(statusRecent.isWithin24hWindow).toBe(true);
      expect(statusRecent.windowExpiresAt).toBeDefined();

      // Case 2: Inbound message received 26 hours ago -> expired
      const expiredInbound = new Date(Date.now() - 26 * 60 * 60 * 1000);
      const statusExpired = client.checkServiceWindow(expiredInbound);
      expect(statusExpired.isWithin24hWindow).toBe(false);

      // Case 3: No previous inbound -> false
      const statusNone = client.checkServiceWindow(null);
      expect(statusNone.isWithin24hWindow).toBe(false);
    });

    it("records outbound text messages and generates provider IDs via mock adapter", async () => {
      const res = await mockWaClient.sendTextMessage({
        to: TEST_CLIENT_PHONE,
        text: "Привет! Это тестовое сообщение.",
      });

      expect(res.messagingProduct).toBe("whatsapp");
      expect(res.messages.length).toBe(1);
      expect(mockWaClient.sentMessages.length).toBe(1);
      expect(mockWaClient.sentMessages[0].to).toBe(TEST_CLIENT_PHONE);
      expect(mockWaClient.sentMessages[0].text).toContain("Привет!");
    });
  });

  describe("3. SCENARIO A: Consultation without Booking", () => {
    it("successfully handles client consultation on PMU brows preparation without creating appointments or debts", async () => {
      const db = database.db;
      const providerMsgId = `wamid.test.scenarioA.${randomUUID()}`;

      const inboundMsg = {
        providerMessageId: providerMsgId,
        fromPhone: TEST_CLIENT_PHONE,
        senderName: "Мария Консультация",
        phoneNumberId: "10001",
        displayPhoneNumber: STUDIO_A_WA_NUMBER,
        body: "Здравствуйте, хочу узнать, как подготовиться к перманентному макияжу бровей",
        timestamp: new Date(),
        rawPayload: { type: "text" },
      };

      const result = await processInboundWhatsAppMessage(inboundMsg, {
        whatsappClient: mockWaClient,
        database: db,
      });

      expect(result.handled).toBe(true);
      expect(result.scenario).toBe("SCENARIO_A_CONSULTATION");
      expect(result.studioId).toBe(studioAId);
      expect(result.clientId).toBeDefined();

      // Verify WhatsApp reply sent
      expect(mockWaClient.sentMessages.length).toBe(1);
      expect(mockWaClient.sentMessages[0].to).toBe(TEST_CLIENT_PHONE);
      expect(mockWaClient.sentMessages[0].text).toContain("Подготовка к перманентному макияжу бровей");
      expect(mockWaClient.sentMessages[0].text).toContain("алкоголь, кофеин");

      // Verify conversation and message persistence
      const conv = await db.query.conversations.findFirst({
        where: and(eq(s.conversations.id, result.conversationId!), eq(s.conversations.studioId, studioAId)),
      });
      expect(conv).toBeDefined();

      const messages = await db
        .select()
        .from(s.conversationMessages)
        .where(eq(s.conversationMessages.conversationId, result.conversationId!));

      expect(messages.length).toBe(2);
      expect(messages[0].direction).toBe("INBOUND");
      expect(messages[0].body).toContain("как подготовиться");
      expect(messages[1].direction).toBe("OUTBOUND");
      expect(messages[1].body).toContain("Подготовка к перманентному макияжу бровей");

      // CRITICAL ARCHITECTURAL INVARIANTS:
      // 1. No Appointment created
      const appts = await db
        .select()
        .from(s.appointments)
        .where(and(eq(s.appointments.studioId, studioAId), eq(s.appointments.clientId, result.clientId!)));
      expect(appts.length).toBe(0);

      // 2. No TreatmentCycle created
      const cycles = await db
        .select()
        .from(s.treatmentCycles)
        .where(and(eq(s.treatmentCycles.studioId, studioAId), eq(s.treatmentCycles.clientId, result.clientId!)));
      expect(cycles.length).toBe(0);

      // 3. No MedicalClearance created
      const clearances = await db
        .select()
        .from(s.cycleMedicalClearances)
        .where(eq(s.cycleMedicalClearances.studioId, studioAId));
      expect(clearances.length).toBe(0);

      // 4. No Consent created
      const consents = await db
        .select()
        .from(s.cycleConsents)
        .where(eq(s.cycleConsents.studioId, studioAId));
      expect(consents.length).toBe(0);

      // 5. No Ledger debt created
      const ledger = await db
        .select()
        .from(s.ledgerEntries)
        .where(and(eq(s.ledgerEntries.studioId, studioAId), eq(s.ledgerEntries.clientId, result.clientId!)));
      expect(ledger.length).toBe(0);
    });
  });

  describe("4. SCENARIO B: Consultation with Booking Inquiry", () => {
    it("suggests available slots and prevents duplicate bookings on replayed webhooks", async () => {
      const db = database.db;
      const providerMsgId = `wamid.test.scenarioB.${randomUUID()}`;

      const inboundMsg = {
        providerMessageId: providerMsgId,
        fromPhone: TEST_CLIENT_PHONE,
        senderName: "Мария Запись",
        phoneNumberId: "10001",
        displayPhoneNumber: STUDIO_A_WA_NUMBER,
        body: "А есть свободное время в пятницу?",
        timestamp: new Date(),
        rawPayload: { type: "text" },
      };

      // 1. First delivery
      const result1 = await processInboundWhatsAppMessage(inboundMsg, {
        whatsappClient: mockWaClient,
        database: db,
      });

      expect(result1.handled).toBe(true);
      expect(result1.scenario).toBe("SCENARIO_B_BOOKING");
      expect(mockWaClient.sentMessages.length).toBe(1);
      expect(mockWaClient.sentMessages[0].text).toContain("доступны следующие интервалы");

      // 2. Replay duplicate webhook with same providerMessageId
      const result2 = await processInboundWhatsAppMessage(inboundMsg, {
        whatsappClient: mockWaClient,
        database: db,
      });

      expect(result2.handled).toBe(true);
      expect(result2.reason).toContain("Duplicate inbound message acknowledged");
      // No second WhatsApp reply sent for duplicate
      expect(mockWaClient.sentMessages.length).toBe(1);
    });
  });

  describe("5. SCENARIO C: Human Takeover & AI Suppression", () => {
    it("transitions conversation to human takeover and suppresses AI auto-replies", async () => {
      const db = database.db;
      const clientPhone = "+393338888888";
      const takeoverMsgId = `wamid.test.takeover.${randomUUID()}`;

      // 1. Client asks to talk to administrator
      const inboundTakeover = {
        providerMessageId: takeoverMsgId,
        fromPhone: clientPhone,
        senderName: "Елена Человек",
        phoneNumberId: "10001",
        displayPhoneNumber: STUDIO_A_WA_NUMBER,
        body: "Хочу поговорить с администратором",
        timestamp: new Date(),
        rawPayload: { type: "text" },
      };

      const result1 = await processInboundWhatsAppMessage(inboundTakeover, {
        whatsappClient: mockWaClient,
        database: db,
      });

      expect(result1.handled).toBe(true);
      expect(result1.scenario).toBe("SCENARIO_C_HUMAN_TAKEOVER");

      // Verify Needs Attention task created
      const staffTasks = await db
        .select()
        .from(s.tasks)
        .where(and(eq(s.tasks.studioId, studioAId), eq(s.tasks.clientId, result1.clientId!)));
      expect(staffTasks.length).toBe(1);
      expect(staffTasks[0].title).toContain("Запрос связи с администратором");
      expect(staffTasks[0].priority).toBe("urgent");

      // Verify client received acknowledgment
      expect(mockWaClient.sentMessages.length).toBe(1);
      expect(mockWaClient.sentMessages[0].text).toContain("передан администратору студии");

      // 2. Staff user assigns / takes over conversation
      await db
        .update(s.conversations)
        .set({ assignedUserId: ownerUserId })
        .where(eq(s.conversations.id, result1.conversationId!));

      // 3. Client sends another question while in Human Takeover
      mockWaClient.clear();
      const followUpMsg = {
        providerMessageId: `wamid.test.followup.${randomUUID()}`,
        fromPhone: clientPhone,
        senderName: "Елена Человек",
        phoneNumberId: "10001",
        displayPhoneNumber: STUDIO_A_WA_NUMBER,
        body: "Вы ещё здесь? Жду ответа.",
        timestamp: new Date(),
        rawPayload: { type: "text" },
      };

      const result2 = await processInboundWhatsAppMessage(followUpMsg, {
        whatsappClient: mockWaClient,
        database: db,
      });

      expect(result2.handled).toBe(true);
      expect(result2.scenario).toBe("SUPPRESSED_HUMAN_TAKEOVER");
      expect(result2.reason).toContain("AI response suppressed: conversation is under active human ownership");
      // STRICT INVARIANT: AI auto-reply is NOT sent
      expect(mockWaClient.sentMessages.length).toBe(0);
    });
  });

  describe("6. Multi-Tenant Isolation & Webhook Routing", () => {
    it("routes incoming webhooks to the correct studio based on whatsappNumber", async () => {
      const db = database.db;

      // Inbound to Studio A
      const inboundA = {
        providerMessageId: `wamid.studioA.${randomUUID()}`,
        fromPhone: "+393331112233",
        displayPhoneNumber: STUDIO_A_WA_NUMBER,
        phoneNumberId: "phone_a",
        body: "Вопрос в студию А",
        timestamp: new Date(),
        rawPayload: {},
      };

      const resA = await processInboundWhatsAppMessage(inboundA, {
        whatsappClient: mockWaClient,
        database: db,
      });
      expect(resA.studioId).toBe(studioAId);

      // Inbound to Studio B
      const inboundB = {
        providerMessageId: `wamid.studioB.${randomUUID()}`,
        fromPhone: "+393331112233",
        displayPhoneNumber: STUDIO_B_WA_NUMBER,
        phoneNumberId: "phone_b",
        body: "Вопрос в студию Б",
        timestamp: new Date(),
        rawPayload: {},
      };

      const resB = await processInboundWhatsAppMessage(inboundB, {
        whatsappClient: mockWaClient,
        database: db,
      });
      expect(resB.studioId).toBe(studioBId);

      // Ensure data isolation
      expect(resA.clientId).not.toBe(resB.clientId);
      expect(resA.conversationId).not.toBe(resB.conversationId);
    });
  });

  describe("7. AI Guardrails & OpenAI Adapter Health Contract", () => {
    it("deterministic safety checks block clinical, financial, and clearance mutations", () => {
      const prohibitedActions = [
        { label: "Approve medical clearance", description: "Bypassing clearance", actionType: "CLEAR_MEDICAL" },
        { label: "Direct refund", description: "Refund 100 EUR", actionType: "REFUND_PAYMENT" },
        { label: "Change cycle stage", description: "Transition to completed", actionType: "CHANGE_STAGE" },
        { label: "Auto send external WhatsApp", description: "Send message without review", actionType: "AUTO_SEND_MESSAGE" },
      ];

      for (const action of prohibitedActions) {
        const violation = checkActionProhibitions(action as any);
        expect(violation).not.toBeNull();
        expect(violation?.code).toBeDefined();
      }
    });

    it("production adapter reports unconfigured state gracefully when API key is missing", () => {
      const unconfigured = new ProductionAiAdapter({ apiKey: "" });
      expect(unconfigured.isConfigured()).toBe(false);
    });
  });

  describe("8. Google Calendar Client & Token Health Contract", () => {
    it("handles calendar API requests and 404 responses gracefully", async () => {
      const fakeFetch = async (url: string) => {
        if (url.includes("/events/non_existent")) {
          return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
        }
        return new Response(JSON.stringify({ id: "evt_123", summary: "PMU Session" }), { status: 200 });
      };

      const client = new GoogleCalendarApiClient("fake_token", fakeFetch as any);
      const notFound = await client.getEvent("primary", "non_existent");
      expect(notFound).toBeNull();

      const event = await client.getEvent("primary", "evt_123");
      expect(event?.id).toBe("evt_123");
    });
  });
});
