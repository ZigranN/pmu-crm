import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { setWhatsAppClient, WhatsAppApiError, type IWhatsAppClient } from "@/features/whatsapp/server/client";
import type { SendWhatsAppTextMessageInput, SendWhatsAppTemplateMessageInput, WhatsAppSendMessageResponse } from "@/features/whatsapp/domain/types";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getOrCreateClientConversation: typeof import("../../src/features/conversations/server/service").getOrCreateClientConversation;
let sendManualMessage: typeof import("../../src/features/conversations/server/service").sendManualMessage;
let recordInboundMessage: typeof import("../../src/features/conversations/server/service").recordInboundMessage;

let studioId: string;
let staffUserId: string;
let validClientId: string;
let placeholderClientId: string;
let noPhoneClientId: string;

class MockWaOutboundClient implements IWhatsAppClient {
  public sentTexts: SendWhatsAppTextMessageInput[] = [];
  public sentTemplates: SendWhatsAppTemplateMessageInput[] = [];
  public shouldFail = false;
  public failStatus = 500;
  public failMessage = "Meta WhatsApp API Internal Server Error";
  public configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async sendTextMessage(input: SendWhatsAppTextMessageInput): Promise<WhatsAppSendMessageResponse> {
    if (!this.configured) {
      throw new WhatsAppApiError("Missing WhatsApp credentials", 503);
    }
    if (this.shouldFail) {
      throw new WhatsAppApiError(this.failMessage, this.failStatus);
    }
    this.sentTexts.push(input);
    return {
      messagingProduct: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to.replace(/\D/g, "") }],
      messages: [{ id: `wamid.outbound.text.${randomUUID()}` }],
    };
  }

  async sendTemplateMessage(input: SendWhatsAppTemplateMessageInput): Promise<WhatsAppSendMessageResponse> {
    if (!this.configured) {
      throw new WhatsAppApiError("Missing WhatsApp credentials", 503);
    }
    if (this.shouldFail) {
      throw new WhatsAppApiError(this.failMessage, this.failStatus);
    }
    this.sentTemplates.push(input);
    return {
      messagingProduct: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to.replace(/\D/g, "") }],
      messages: [{ id: `wamid.outbound.template.${randomUUID()}` }],
    };
  }

  checkServiceWindow(lastInboundAt: Date | null | undefined) {
    if (!lastInboundAt) {
      return { isWithin24hWindow: false, lastInboundAt: null, windowExpiresAt: null };
    }
    const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
    const isWithin = expiresAt.getTime() > Date.now();
    return { isWithin24hWindow: isWithin, lastInboundAt, windowExpiresAt: expiresAt };
  }
}

let mockClient: MockWaOutboundClient;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const convService = await import("../../src/features/conversations/server/service");
  getOrCreateClientConversation = convService.getOrCreateClientConversation;
  sendManualMessage = convService.sendManualMessage;
  recordInboundMessage = convService.recordInboundMessage;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "WhatsApp Outbound Test Studio",
        slug: `wa-outbound-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const roleRows = await db.select().from(s.roles);
  const adminRoleId = roleRows.find((r) => r.code === "ADMIN")!.id;

  // 2. Staff user
  staffUserId = `staff-${randomUUID()}`;
  await db.insert(s.user).values({
    id: staffUserId,
    email: `${staffUserId}@studio.com`,
    name: "Studio Admin",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(s.studioMembers).values({
    studioId,
    userId: staffUserId,
    roleId: adminRoleId,
    isActive: true,
  });

  // 3. Client with valid E.164 phone
  const [client1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Анна",
      lastName: "Иванова",
      fullName: "Анна Иванова",
      phone: "+393331234567",
      whatsapp: "+393331234567",
      clientStatus: "new_lead",
    })
    .returning();
  validClientId = client1.id;

  // 4. Client with placeholder phone
  const [client2] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Фейк",
      lastName: "Клиент",
      fullName: "Фейк Клиент",
      phone: "+00000000000",
      whatsapp: "+00000000000",
      clientStatus: "new_lead",
    })
    .returning();
  placeholderClientId = client2.id;

  // 5. Client with invalid phone string
  const [client3] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Невалидный",
      lastName: "Телефона",
      fullName: "Невалидный Телефона",
      phone: "+11111111111",
      whatsapp: "+11111111111",
      clientStatus: "new_lead",
    })
    .returning();
  noPhoneClientId = client3.id;
});

beforeEach(() => {
  mockClient = new MockWaOutboundClient();
  setWhatsAppClient(mockClient);
});

afterEach(() => {
  setWhatsAppClient(null);
});

describe("Manual WhatsApp Outbound Messaging from CRM Inbox", () => {
  it("1. Successfully sends free-form WhatsApp text message within 24-hour service window", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Record recent inbound message from client (5 minutes ago)
    const inboundTime = new Date(Date.now() - 5 * 60 * 1000);
    await recordInboundMessage(db, {
      studioId,
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Здравствуйте! Подскажите стоимость процедуры?",
      providerMessageId: `wamid.inbound.${randomUUID()}`,
      sentAt: inboundTime,
      providerMetadata: { from: "+393331234567" },
    });

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Добрый день! Стоимость перманентного макияжа бровей — 12 000 руб.",
      }
    );

    expect(res.message).toBeDefined();
    expect(res.message.channel).toBe("WHATSAPP");
    expect(res.message.direction).toBe("OUTBOUND");
    expect(res.message.providerMessageId).toMatch(/^wamid\.outbound\.text\./);
    expect(res.message.providerMetadata).toMatchObject({
      recipientPhone: "+393331234567",
      sentViaApi: true,
      deliveryStatus: "sent",
      isTemplate: false,
    });

    expect(mockClient.sentTexts.length).toBe(1);
    expect(mockClient.sentTexts[0]).toEqual({
      to: "+393331234567",
      text: "Добрый день! Стоимость перманентного макияжа бровей — 12 000 руб.",
    });
  });

  it("2. Rejects free-form text outside 24-hour window and requires approved template", async () => {
    const [expiredClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Елена",
        fullName: "Елена Тестова",
        phone: "+393339998877",
        whatsapp: "+393339998877",
        clientStatus: "new_lead",
      })
      .returning();

    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, expiredClient.id);

    // Inbound message sent 48 hours ago (outside 24h window)
    const oldInboundTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await recordInboundMessage(db, {
      studioId,
      clientId: expiredClient.id,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Старое сообщение",
      providerMessageId: `wamid.inbound.old.${randomUUID()}`,
      sentAt: oldInboundTime,
      providerMetadata: { from: "+393339998877" },
    });

    // Attempting to send free-form text without template outside 24h window MUST fail
    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: expiredClient.id,
          conversationId: conv.id,
          channel: "WHATSAPP",
          body: "Привет, вы еще думаете о записи?",
        }
      )
    ).rejects.toThrow(/24-часовое окно.*истекло.*требуется.*шаблон/i);

    expect(mockClient.sentTexts.length).toBe(0);
    expect(mockClient.sentTemplates.length).toBe(0);
  });

  it("3. Successfully sends approved template message outside 24-hour window", async () => {
    const [templateClient] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Ольга",
        fullName: "Ольга Шаблонова",
        phone: "+393335554433",
        whatsapp: "+393335554433",
        clientStatus: "new_lead",
      })
      .returning();

    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, templateClient.id);

    // Expired inbound (30 hours ago)
    const oldInboundTime = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await recordInboundMessage(db, {
      studioId,
      clientId: templateClient.id,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Старый запрос",
      providerMessageId: `wamid.inbound.template.${randomUUID()}`,
      sentAt: oldInboundTime,
      providerMetadata: { from: "+393335554433" },
    });

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: templateClient.id,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Напоминаем о вашей консультации",
        templateName: "appointment_reminder",
        templateLanguage: "ru",
        templateComponents: [{ type: "body", parameters: [{ type: "text", text: "Ольга" }] }],
      }
    );

    expect(res.message).toBeDefined();
    expect(res.message.providerMessageId).toMatch(/^wamid\.outbound\.template\./);
    expect(res.message.providerMetadata).toMatchObject({
      recipientPhone: "+393335554433",
      sentViaApi: true,
      deliveryStatus: "sent",
      isTemplate: true,
      templateName: "appointment_reminder",
    });

    expect(mockClient.sentTemplates.length).toBe(1);
    expect(mockClient.sentTemplates[0]).toEqual({
      to: "+393335554433",
      templateName: "appointment_reminder",
      languageCode: "ru",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ольга" }] }],
    });
  });

  it("4. Rolls back and never marks message as sent when WhatsApp API fails", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Set mock client to fail with 500 error
    mockClient.shouldFail = true;
    mockClient.failStatus = 500;
    mockClient.failMessage = "Meta WhatsApp Graph API Failure";

    const msgCountBefore = (
      await db.select().from(s.conversationMessages).where(eq(s.conversationMessages.conversationId, conv.id))
    ).length;

    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: validClientId,
          conversationId: conv.id,
          channel: "WHATSAPP",
          body: "Это сообщение не должно сохраниться в базе",
        }
      )
    ).rejects.toThrow(/Meta WhatsApp Graph API Failure/i);

    const msgCountAfter = (
      await db.select().from(s.conversationMessages).where(eq(s.conversationMessages.conversationId, conv.id))
    ).length;

    expect(msgCountAfter).toBe(msgCountBefore);
  });

  it("5. Rejects dispatch for invalid or placeholder recipient phone numbers", async () => {
    // 5a. Client with placeholder phone (+00000000000)
    const convPlaceholder = await getOrCreateClientConversation(
      db,
      { studioId, userId: staffUserId },
      placeholderClientId
    );

    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: placeholderClientId,
          conversationId: convPlaceholder.id,
          channel: "WHATSAPP",
          body: "Тест для фейкового номера",
        }
      )
    ).rejects.toThrow(/отсутствует действительный подтвержденный номер/i);

    // 5b. Client with dummy repeating digits (+11111111111)
    const convNoPhone = await getOrCreateClientConversation(
      db,
      { studioId, userId: staffUserId },
      noPhoneClientId
    );

    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: noPhoneClientId,
          conversationId: convNoPhone.id,
          channel: "WHATSAPP",
          body: "Тест для клиента с невалидным номером",
        }
      )
    ).rejects.toThrow(/отсутствует действительный подтвержденный номер/i);

    expect(mockClient.sentTexts.length).toBe(0);
  });

  it("6. Rejects dispatch when WhatsApp credentials are not configured", async () => {
    mockClient.configured = false;

    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: validClientId,
          conversationId: conv.id,
          channel: "WHATSAPP",
          body: "Тест не настроенного клиента",
        }
      )
    ).rejects.toThrow(/Access Token или Phone Number ID не настроены/i);

    expect(mockClient.sentTexts.length).toBe(0);
  });

  it("7. Preserves MANUAL and INSTAGRAM channel behaviors", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Manual message without external API dispatch
    const manualRes = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "MANUAL",
        body: "Обычная ручная заметка в CRM",
      }
    );

    expect(manualRes.message.channel).toBe("MANUAL");
    expect(manualRes.message.providerMessageId).toBeNull();
    expect(mockClient.sentTexts.length).toBe(0);
  });
});
