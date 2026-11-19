import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  setWhatsAppClient,
  WhatsAppApiError,
  type IWhatsAppClient,
  classifyWhatsAppError,
} from "@/features/whatsapp/server/client";
import type {
  SendWhatsAppTextMessageInput,
  SendWhatsAppTemplateMessageInput,
  WhatsAppSendMessageResponse,
  WhatsAppServiceWindowStatus,
} from "@/features/whatsapp/domain/types";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getOrCreateClientConversation: typeof import("../../src/features/conversations/server/service").getOrCreateClientConversation;
let sendManualMessage: typeof import("../../src/features/conversations/server/service").sendManualMessage;
let recordInboundMessage: typeof import("../../src/features/conversations/server/service").recordInboundMessage;
let sendManualMessageAction: typeof import("../../src/features/conversations/server/actions").sendManualMessageAction;

let studioId: string;
let staffUserId: string;
let validClientId: string;
let placeholderClientId: string;
let noPhoneClientId: string;

vi.mock("@/server/auth/context", () => ({
  requireBrowserStudioContext: vi.fn(async () => ({
    studioId,
    userId: staffUserId,
  })),
  readSession: vi.fn(async () => ({
    user: { id: staffUserId, email: `${staffUserId}@studio.com` },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

class MockWaOutboundClient implements IWhatsAppClient {
  public sentTexts: SendWhatsAppTextMessageInput[] = [];
  public sentTemplates: SendWhatsAppTemplateMessageInput[] = [];
  public shouldFail = false;
  public failError: Error = new WhatsAppApiError("Meta WhatsApp API Internal Server Error", 500);
  public configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async sendTextMessage(input: SendWhatsAppTextMessageInput): Promise<WhatsAppSendMessageResponse> {
    if (!this.configured) {
      throw new WhatsAppApiError("Missing WhatsApp credentials", 503);
    }
    if (this.shouldFail) {
      throw this.failError;
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
      throw this.failError;
    }
    this.sentTemplates.push(input);
    return {
      messagingProduct: "whatsapp",
      contacts: [{ input: input.to, wa_id: input.to.replace(/\D/g, "") }],
      messages: [{ id: `wamid.outbound.template.${randomUUID()}` }],
    };
  }

  checkServiceWindow(lastInboundAt: Date | null | undefined): WhatsAppServiceWindowStatus {
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
  const convActions = await import("../../src/features/conversations/server/actions");
  getOrCreateClientConversation = convService.getOrCreateClientConversation;
  sendManualMessage = convService.sendManualMessage;
  recordInboundMessage = convService.recordInboundMessage;
  sendManualMessageAction = convActions.sendManualMessageAction;

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

  it("2. Successfully sends approved template message outside 24-hour window", async () => {
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

  it("3. Handles 24-hour service window expiry safely without throwing 500", async () => {
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

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: expiredClient.id,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Привет, вы еще думаете о записи?",
      }
    );

    expect(res.message).toBeDefined();
    expect(res.message.providerMessageId).toBeNull();
    expect(res.message.providerMetadata).toMatchObject({
      sentViaApi: false,
      deliveryStatus: "failed",
      errorCode: "WINDOW_EXPIRED",
      failureStage: "preflight_validation",
    });

    expect(mockClient.sentTexts.length).toBe(0);
    expect(mockClient.sentTemplates.length).toBe(0);
  });

  it("4. Handles Meta Error 190 (Invalid / Expired Token) safely and persists failed message", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Inbound within 24h
    await recordInboundMessage(db, {
      studioId,
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Тест токена",
      providerMessageId: `wamid.inbound.${randomUUID()}`,
      sentAt: new Date(),
      providerMetadata: { from: "+393331234567" },
    });

    mockClient.shouldFail = true;
    mockClient.failError = new WhatsAppApiError(
      "Error validating access token: Session has expired on Nov 19. Bearer EAAtestsecrettoken123",
      401,
      { code: 190, subcode: 463, fbtraceId: "fb_wa_trace_190" }
    );

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Сообщение при истекшем токене",
      }
    );

    expect(res.message).toBeDefined();
    expect(res.message.providerMessageId).toBeNull();
    const metadata = res.message.providerMetadata as Record<string, unknown>;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("190");
    expect(metadata.errorSubcode).toBe("463");
    expect(metadata.failureStage).toBe("provider_dispatch");
    expect(String(metadata.sendError)).toContain("Code 190, Subcode 463");
    expect(String(metadata.sendError)).not.toContain("EAAtestsecrettoken123");
    expect(String(metadata.sendError)).toContain("[REDACTED_TOKEN]");
  });

  it("5. Handles Meta Error 131047 (Re-engagement message / 24h window policy) safely", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    await recordInboundMessage(db, {
      studioId,
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Тест 131047",
      providerMessageId: `wamid.inbound.${randomUUID()}`,
      sentAt: new Date(),
      providerMetadata: { from: "+393331234567" },
    });

    mockClient.shouldFail = true;
    mockClient.failError = new WhatsAppApiError(
      "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
      400,
      { code: 131047, fbtraceId: "fb_wa_trace_131047" }
    );

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Сообщение вне окна на стороне Meta",
      }
    );

    expect(res.message).toBeDefined();
    expect(res.message.providerMessageId).toBeNull();
    const metadata = res.message.providerMetadata as Record<string, unknown>;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("131047");
    expect(metadata.failureStage).toBe("provider_dispatch");
  });

  it("6. Handles invalid or placeholder recipient phone numbers safely", async () => {
    const convPlaceholder = await getOrCreateClientConversation(
      db,
      { studioId, userId: staffUserId },
      placeholderClientId
    );

    const resPlaceholder = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: placeholderClientId,
        conversationId: convPlaceholder.id,
        channel: "WHATSAPP",
        body: "Тест для фейкового номера",
      }
    );

    expect(resPlaceholder.message.providerMetadata).toMatchObject({
      sentViaApi: false,
      deliveryStatus: "failed",
      errorCode: "INVALID_RECIPIENT_PHONE",
      failureStage: "preflight_validation",
    });

    const convNoPhone = await getOrCreateClientConversation(
      db,
      { studioId, userId: staffUserId },
      noPhoneClientId
    );

    const resNoPhone = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: noPhoneClientId,
        conversationId: convNoPhone.id,
        channel: "WHATSAPP",
        body: "Тест для клиента с невалидным номером",
      }
    );

    expect(resNoPhone.message.providerMetadata).toMatchObject({
      sentViaApi: false,
      deliveryStatus: "failed",
      errorCode: "INVALID_RECIPIENT_PHONE",
      failureStage: "preflight_validation",
    });

    expect(mockClient.sentTexts.length).toBe(0);
  });

  it("7. Handles unconfigured WhatsApp credentials safely", async () => {
    mockClient.configured = false;

    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "WHATSAPP",
        body: "Тест не настроенного клиента",
      }
    );

    expect(res.message.providerMetadata).toMatchObject({
      sentViaApi: false,
      deliveryStatus: "failed",
      errorCode: "AUTH_NOT_CONFIGURED",
      failureStage: "auth_configuration",
    });

    expect(mockClient.sentTexts.length).toBe(0);
  });

  it("8. Protects against duplicate message sends using requestKey", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    await recordInboundMessage(db, {
      studioId,
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Запрос на повторную отправку",
      providerMessageId: `wamid.inbound.dupe.${randomUUID()}`,
      sentAt: new Date(),
      providerMetadata: { from: "+393331234567" },
    });

    const requestKey = randomUUID();

    const firstRes = await sendManualMessageAction({
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Первая отправка с ключом идемпотентности",
      requestKey,
    });

    expect(firstRes.message.providerMetadata).toMatchObject({
      sentViaApi: true,
      deliveryStatus: "sent",
    });
    expect(mockClient.sentTexts.length).toBe(1);

    const secondRes = await sendManualMessageAction({
      clientId: validClientId,
      conversationId: conv.id,
      channel: "WHATSAPP",
      body: "Первая отправка с ключом идемпотентности",
      requestKey,
    });

    expect(secondRes.message.id).toBe(firstRes.message.id);
    expect(secondRes.message.providerMessageId).toBe(firstRes.message.providerMessageId);
    expect(mockClient.sentTexts.length).toBe(1);
  });

  it("9. Handles database failure gracefully", async () => {
    const brokenDb = {
      ...db,
      select: vi.fn(() => {
        throw new Error("DB_FATAL_CONNECTION_POOL_EXHAUSTED");
      }),
      transaction: vi.fn(async () => {
        throw new Error("DB_FATAL_CONNECTION_POOL_EXHAUSTED");
      }),
    } as any;

    await expect(
      sendManualMessage(
        brokenDb,
        { studioId, userId: staffUserId },
        {
          clientId: validClientId,
          channel: "WHATSAPP",
          body: "Тест ошибки БД",
        }
      )
    ).rejects.toThrow("DB_FATAL_CONNECTION_POOL_EXHAUSTED");
  });

  it("10. Sanitizes sensitive credentials and phone numbers in error classification", () => {
    const rawError = new WhatsAppApiError(
      "Failed to call Meta API with access_token=EAAB1234567890abcdef and secret=client_secret=mysupersecret and phone +393331234567",
      400,
      { code: 100 }
    );

    const classified = classifyWhatsAppError(rawError);
    expect(classified.sanitizedMessage).not.toContain("EAAB1234567890abcdef");
    expect(classified.sanitizedMessage).not.toContain("mysupersecret");
    expect(classified.sanitizedMessage).not.toContain("+393331234567");
    expect(classified.sanitizedMessage).toContain("[REDACTED_TOKEN]");
    expect(classified.sanitizedMessage).toContain("[REDACTED_SECRET]");
    expect(classified.sanitizedMessage).toContain("[REDACTED_PHONE]");
    expect(classified.errorType).toBe("INVALID_PARAMETER");
  });
});
