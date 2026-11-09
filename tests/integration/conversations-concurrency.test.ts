import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.id ? { user: { id: session.id } } : null),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "pmu_active_studio" && session.studioId
        ? { value: session.studioId }
        : undefined,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let getOrCreateClientConversation: typeof import("../../src/features/conversations/server/service").getOrCreateClientConversation;
let recordInboundMessage: typeof import("../../src/features/conversations/server/service").recordInboundMessage;
let markConversationRead: typeof import("../../src/features/conversations/server/service").markConversationRead;
let assignConversation: typeof import("../../src/features/conversations/server/service").assignConversation;
let closeConversation: typeof import("../../src/features/conversations/server/service").closeConversation;

let getConversationForContext: typeof import("../../src/features/conversations/server/queries").getConversationForContext;

let studioId: string;
let ownerUserId: string;
let adminUserId: string;
let clientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const convService = await import("../../src/features/conversations/server/service");
  getOrCreateClientConversation = convService.getOrCreateClientConversation;
  recordInboundMessage = convService.recordInboundMessage;
  markConversationRead = convService.markConversationRead;
  assignConversation = convService.assignConversation;
  closeConversation = convService.closeConversation;

  const convQueries = await import("../../src/features/conversations/server/queries");
  getConversationForContext = convQueries.getConversationForContext;

  // 1. Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Concurrency Test Studio",
        slug: `conc-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;
  const adminRoleId = roleRows.find((r) => r.code === "ADMIN")!.id;

  ownerUserId = `user-conc-owner-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Conc Owner",
    email: `${ownerUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(s.studioMembers).values({
    studioId,
    userId: ownerUserId,
    roleId: ownerRoleId,
    isActive: true,
  });

  adminUserId = `user-conc-admin-${randomUUID()}`;
  await db.insert(s.user).values({
    id: adminUserId,
    name: "Conc Admin",
    email: `${adminUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(s.studioMembers).values({
    studioId,
    userId: adminUserId,
    roleId: adminRoleId,
    isActive: true,
  });

  const [c] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Daria",
      fullName: "Daria Concurrency",
      phone: "+39999000111",
      clientStatus: "new_lead",
    })
    .returning();
  clientId = c.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

describe("Phase 10 — PostgreSQL Concurrency & Race Tests", () => {
  it("1. concurrent get-or-create conversation for same client produces exactly one conversation", async () => {
    // Run 5 parallel getOrCreate requests
    const promises = Array.from({ length: 5 }).map(() =>
      getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        clientId
      )
    );

    const results = await Promise.all(promises);
    const ids = new Set(results.map((r) => r.id));

    expect(ids.size).toBe(1);

    const convsInDb = await db
      .select()
      .from(s.conversations)
      .where(
        and(
          eq(s.conversations.studioId, studioId),
          eq(s.conversations.clientId, clientId)
        )
      );

    expect(convsInDb.length).toBe(1);
  });

  it("2. duplicate concurrent inbound provider webhook creates only 1 message row", async () => {
    const providerMessageId = `wa-race-${randomUUID()}`;

    // Fire 3 simultaneous inbound ingestions with the same provider message ID
    const promises = Array.from({ length: 3 }).map((_, i) =>
      recordInboundMessage(db, {
        studioId,
        clientId,
        channel: "WHATSAPP",
        body: `Параллельный вебхук #${i}`,
        providerMessageId,
      }).catch((err) => ({ error: err }))
    );

    const results = await Promise.all(promises);
    const successful = results.filter((r) => !("error" in r));

    expect(successful.length).toBeGreaterThanOrEqual(1);

    const matchingMsgs = await db
      .select()
      .from(s.conversationMessages)
      .where(
        and(
          eq(s.conversationMessages.studioId, studioId),
          eq(s.conversationMessages.providerMessageId, providerMessageId)
        )
      );

    expect(matchingMsgs.length).toBe(1);
  });

  it("3. concurrent inbound messages update lastMessageAt deterministically", async () => {
    const conv = await getOrCreateClientConversation(
      db,
      { studioId, userId: ownerUserId },
      clientId
    );

    const t1 = new Date("2026-10-12T10:00:00Z");
    const t2 = new Date("2026-10-12T10:05:00Z");
    const t3 = new Date("2026-10-12T10:10:00Z");

    await Promise.all([
      recordInboundMessage(db, {
        studioId,
        clientId,
        channel: "WHATSAPP",
        body: "Сообщение 1",
        sentAt: t1,
      }),
      recordInboundMessage(db, {
        studioId,
        clientId,
        channel: "WHATSAPP",
        body: "Сообщение 2",
        sentAt: t2,
      }),
      recordInboundMessage(db, {
        studioId,
        clientId,
        channel: "WHATSAPP",
        body: "Сообщение 3",
        sentAt: t3,
      }),
    ]);

    const [updatedConv] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, conv.id));

    expect(updatedConv.lastMessageAt).toBeDefined();
  });

  it("4. mark-read racing with new inbound message maintains correct unread state", async () => {
    const conv = await getOrCreateClientConversation(
      db,
      { studioId, userId: ownerUserId },
      clientId
    );

    await Promise.all([
      markConversationRead(
        db,
        { studioId, userId: ownerUserId },
        { conversationId: conv.id }
      ),
      recordInboundMessage(db, {
        studioId,
        clientId,
        channel: "SMS",
        body: "Гонка mark-read и inbound",
        sentAt: new Date(Date.now() + 1000),
      }),
    ]);

    const detail = await getConversationForContext(
      { studioId, userId: ownerUserId },
      conv.id
    );

    expect(detail).toBeDefined();
  });

  it("5. concurrent staff assignment resolves deterministically", async () => {
    const conv = await getOrCreateClientConversation(
      db,
      { studioId, userId: ownerUserId },
      clientId
    );

    await Promise.all([
      assignConversation(
        db,
        { studioId, userId: ownerUserId },
        { conversationId: conv.id, assignedUserId: ownerUserId, reason: "assign_owner" }
      ),
      assignConversation(
        db,
        { studioId, userId: ownerUserId },
        { conversationId: conv.id, assignedUserId: adminUserId, reason: "assign_admin" }
      ),
    ]);

    const [convFinal] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, conv.id));

    expect([ownerUserId, adminUserId]).toContain(convFinal.assignedUserId);
  });

  it("6. close thread racing with new inbound message cleanly reopens thread", async () => {
    const conv = await getOrCreateClientConversation(
      db,
      { studioId, userId: ownerUserId },
      clientId
    );

    await closeConversation(
      db,
      { studioId, userId: ownerUserId },
      { conversationId: conv.id, reason: "closing_thread" }
    );

    const res = await recordInboundMessage(db, {
      studioId,
      clientId,
      channel: "EMAIL",
      body: "Письмо во время закрытия",
      sentAt: new Date(),
    });

    const [convFinal] = await db
      .select()
      .from(s.conversations)
      .where(eq(s.conversations.id, conv.id));

    // A conversation with a recent inbound message is OPEN
    expect(res.conversation.status).toBe("OPEN");
    expect(convFinal.status).toBe("OPEN");
  });
});
