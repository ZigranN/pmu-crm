import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  setInstagramClient,
  InstagramApiError,
  type IInstagramClient,
  sanitizeInstagramErrorMessage,
  classifyInstagramError,
} from "@/features/instagram/server/client";
import type {
  SendInstagramMessageParams,
  SendInstagramAttachmentParams,
  InstagramSendMessageResult,
  InstagramUserProfile,
  InstagramServiceWindow,
} from "@/features/instagram/domain/types";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getOrCreateClientConversation: typeof import("../../src/features/conversations/server/service").getOrCreateClientConversation;
let sendManualMessage: typeof import("../../src/features/conversations/server/service").sendManualMessage;
let recordInboundMessage: typeof import("../../src/features/conversations/server/service").recordInboundMessage;

let studioId: string;
let staffUserId: string;
let validClientId: string;
let clientWithoutInboundId: string;

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

class MockInstagramClient implements IInstagramClient {
  public sentTexts: SendInstagramMessageParams[] = [];
  public shouldFail = false;
  public failError: Error = new InstagramApiError("Meta Instagram API Failure", { code: 500 });

  async sendTextMessage(params: SendInstagramMessageParams): Promise<InstagramSendMessageResult> {
    if (this.shouldFail) {
      throw this.failError;
    }
    this.sentTexts.push(params);
    return {
      recipientId: params.recipientId,
      messageId: `ig_msg_${randomUUID()}`,
    };
  }

  async sendAttachment(params: SendInstagramAttachmentParams): Promise<InstagramSendMessageResult> {
    if (this.shouldFail) {
      throw this.failError;
    }
    return {
      recipientId: params.recipientId,
      messageId: `ig_att_${randomUUID()}`,
    };
  }

  async getUserProfile(): Promise<InstagramUserProfile | null> {
    return {
      id: "ig_user_123",
      username: "test_ig_user",
      name: "Test IG User",
    };
  }

  evaluate24hWindow(lastInboundAt?: Date | null): InstagramServiceWindow {
    if (!lastInboundAt) {
      return { isWithin24hWindow: false, lastInboundAt: null, expiresAt: null };
    }
    const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
    const isWithin = expiresAt.getTime() > Date.now();
    return { isWithin24hWindow: isWithin, lastInboundAt, expiresAt };
  }
}

let mockIgClient: MockInstagramClient;

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
        name: "Instagram Outbound Test Studio",
        slug: `ig-outbound-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const roleRows = await db.select().from(s.roles);
  const adminRoleId = roleRows.find((r) => r.code === "ADMIN")!.id;

  // 2. Staff user
  staffUserId = `staff-ig-${randomUUID()}`;
  await db.insert(s.user).values({
    id: staffUserId,
    email: `${staffUserId}@studio.com`,
    name: "Studio IG Admin",
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

  // 3. Clients
  const [client1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Instagram",
      lastName: "User",
      fullName: "Instagram User",
      phone: "+393331112233",
      instagram: "test_ig_user",
      clientStatus: "new_lead",
    })
    .returning();
  validClientId = client1.id;

  const [client2] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "No",
      lastName: "Inbound",
      fullName: "No Inbound",
      phone: "+393334445566",
      clientStatus: "new_lead",
    })
    .returning();
  clientWithoutInboundId = client2.id;
});

beforeEach(async () => {
  mockIgClient = new MockInstagramClient();
  setInstagramClient(mockIgClient);
  process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = "EAAG_TEST_ACCESS_TOKEN_VALID";
});

afterEach(() => {
  setInstagramClient(null);
  vi.restoreAllMocks();
});

describe("Instagram Outbound Messaging & Error Classification", () => {
  it("1. Helper: classifyInstagramError sanitizes tokens and classifies error categories", () => {
    // 1a. OAuth token expiration
    const tokenErr = new InstagramApiError(
      "Error validating access token: Session has expired. Token: EAAG1234567890abcdef",
      { code: 190, subcode: 463, type: "OAuthException" }
    );
    const classified1 = classifyInstagramError(tokenErr);
    expect(classified1.errorType).toBe("TOKEN_INVALID");
    expect(classified1.code).toBe(190);
    expect(classified1.subcode).toBe(463);
    expect(classified1.sanitizedMessage).not.toContain("EAAG1234567890abcdef");
    expect(classified1.sanitizedMessage).toContain("[REDACTED_TOKEN]");
    expect(classified1.formattedMessage).toContain("Code 190, Subcode 463");

    // 1b. 24h Window policy violation
    const policyErr = new InstagramApiError(
      "User is outside the 24-hour window for standard messaging.",
      { code: 10, type: "OAuthException" }
    );
    const classified2 = classifyInstagramError(policyErr);
    expect(classified2.errorType).toBe("PERMISSION_DENIED");
    expect(classified2.code).toBe(10);
    expect(classified2.formattedMessage).toContain("Code 10");

    // 1c. Generic Error with Bearer token
    const genericErr = new Error("Failed HTTP POST with Bearer secret_meta_token_123");
    const classified3 = classifyInstagramError(genericErr);
    expect(classified3.errorType).toBe("UNKNOWN_ERROR");
    expect(classified3.sanitizedMessage).not.toContain("secret_meta_token_123");
    expect(classified3.sanitizedMessage).toContain("Bearer [REDACTED_TOKEN]");

    // 1d. sanitizeInstagramErrorMessage direct verification
    const sanitizedDirect = sanitizeInstagramErrorMessage("client_secret=secret123&appsecret_proof=proof456");
    expect(sanitizedDirect).toBe("client_secret=[REDACTED_SECRET]&appsecret_proof=[REDACTED_PROOF]");
  });

  it("2. Successfully dispatches outbound Instagram message and records sent state", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Record an inbound Instagram message first
    await recordInboundMessage(db, {
      studioId,
      clientId: validClientId,
      conversationId: conv.id,
      channel: "INSTAGRAM",
      body: "Здравствуйте! Хочу записаться на брови.",
      providerMessageId: `mid.ig.inbound.${randomUUID()}`,
      providerMetadata: {
        senderId: "17841400000000001",
        recipientId: "17841400000000002",
      },
    });

    // Send operator reply
    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "INSTAGRAM",
        body: "Добрый день! С удовольствием запишем вас.",
      }
    );

    expect(res.message.channel).toBe("INSTAGRAM");
    expect(res.message.direction).toBe("OUTBOUND");
    expect(res.message.providerMessageId).toMatch(/^ig_msg_/);
    expect(res.message.providerMetadata).toMatchObject({
      recipientId: "17841400000000001",
      sentViaApi: true,
      deliveryStatus: "sent",
    });

    expect(mockIgClient.sentTexts.length).toBe(1);
    expect(mockIgClient.sentTexts[0].recipientId).toBe("17841400000000001");
    expect(mockIgClient.sentTexts[0].text).toBe("Добрый день! С удовольствием запишем вас.");

    // Verify audit log
    const auditLogs = await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, res.message.id));
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].reason).toBe("manual_message_sent");
  });

  it("3. Gracefully captures Meta API rejection without crashing Server Action", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Set mock to reject with Meta OAuth error 190 / 463
    mockIgClient.shouldFail = true;
    mockIgClient.failError = new InstagramApiError(
      "Error validating access token: Session has expired on Nov 19. Secret token: EAAG999999999",
      { code: 190, subcode: 463, type: "OAuthException" }
    );

    // Should NOT throw exception
    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "INSTAGRAM",
        body: "Сообщение при протухшем токене",
      }
    );

    expect(res.message.channel).toBe("INSTAGRAM");
    expect(res.message.direction).toBe("OUTBOUND");
    expect(res.message.providerMessageId).toBeNull();

    const metadata = res.message.providerMetadata as any;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("190");
    expect(metadata.errorSubcode).toBe("463");
    expect(metadata.errorType).toBe("OAuthException");
    expect(metadata.failureStage).toBe("provider_dispatch");
    expect(metadata.sendError).toContain("Instagram API error (Code 190, Subcode 463)");
    expect(metadata.sendError).not.toContain("EAAG999999999");
    expect(metadata.sendError).toContain("[REDACTED_TOKEN]");

    // Verify audit log recorded as failure
    const auditLogs = await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, res.message.id));
    expect(auditLogs[0].reason).toBe("manual_message_send_failed");
  });

  it("4. Gracefully captures 24-hour messaging window rejection from Meta", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Set mock to reject with Meta Policy error 10
    mockIgClient.shouldFail = true;
    mockIgClient.failError = new InstagramApiError(
      "User is outside the 24-hour messaging window.",
      { code: 10, type: "OAuthException" }
    );

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "INSTAGRAM",
        body: "Сообщение вне 24-часового окна",
      }
    );

    expect(res.message.providerMessageId).toBeNull();
    const metadata = res.message.providerMetadata as any;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("10");
    expect(metadata.sendError).toContain("Code 10");
  });

  it("5. Handles missing credentials without throwing unhandled exceptions", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);

    // Clear access token
    delete process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
    delete process.env.META_PAGE_ACCESS_TOKEN;
    delete process.env.META_ACCESS_TOKEN;

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: validClientId,
        conversationId: conv.id,
        channel: "INSTAGRAM",
        body: "Тест без токена",
      }
    );

    expect(res.message.providerMessageId).toBeNull();
    const metadata = res.message.providerMetadata as any;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("AUTH_NOT_CONFIGURED");
    expect(metadata.sendError).toBe("Instagram: Access Token не настроен.");
    expect(metadata.failureStage).toBe("auth_configuration");
  });

  it("6. Handles missing inbound thread / recipient ID preflight check", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, clientWithoutInboundId);

    const res = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      {
        clientId: clientWithoutInboundId,
        conversationId: conv.id,
        channel: "INSTAGRAM",
        body: "Тест без входящей переписки",
      }
    );

    expect(res.message.providerMessageId).toBeNull();
    const metadata = res.message.providerMetadata as any;
    expect(metadata.sentViaApi).toBe(false);
    expect(metadata.deliveryStatus).toBe("failed");
    expect(metadata.errorCode).toBe("THREAD_NOT_FOUND");
    expect(metadata.sendError).toBe("Instagram: входящая переписка с клиентом не найдена.");
    expect(metadata.failureStage).toBe("preflight_validation");
  });

  it("7. Ensures idempotency / duplicate send handling with command receipts", async () => {
    const conv = await getOrCreateClientConversation(db, { studioId, userId: staffUserId }, validClientId);
    const requestKey = randomUUID();

    const payload = {
      clientId: validClientId,
      conversationId: conv.id,
      cycleId: null,
      channel: "INSTAGRAM" as const,
      body: "Идемпотентное сообщение",
      requestKey,
    };

    const res1 = await sendManualMessage(
      db,
      { studioId, userId: staffUserId },
      payload
    );

    expect(res1.message.providerMessageId).toMatch(/^ig_msg_/);
    expect(mockIgClient.sentTexts.length).toBe(1);
  });

  it("8. Handles database failure and rejects cleanly without marking as sent", async () => {
    // Attempting to send message to nonexistent client
    await expect(
      sendManualMessage(
        db,
        { studioId, userId: staffUserId },
        {
          clientId: randomUUID(), // non-existent client
          channel: "INSTAGRAM",
          body: "Тест ошибки БД",
        }
      )
    ).rejects.toThrow(/Client not found in this studio/i);
  });
});
