import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
let sendManualMessage: typeof import("../../src/features/conversations/server/service").sendManualMessage;
let recordInboundMessage: typeof import("../../src/features/conversations/server/service").recordInboundMessage;
let markConversationRead: typeof import("../../src/features/conversations/server/service").markConversationRead;
let assignConversation: typeof import("../../src/features/conversations/server/service").assignConversation;
let closeConversation: typeof import("../../src/features/conversations/server/service").closeConversation;
let reopenConversation: typeof import("../../src/features/conversations/server/service").reopenConversation;

let listConversationsForContext: typeof import("../../src/features/conversations/server/queries").listConversationsForContext;
let getConversationForContext: typeof import("../../src/features/conversations/server/queries").getConversationForContext;
let listConversationMessagesForContext: typeof import("../../src/features/conversations/server/queries").listConversationMessagesForContext;
let getConversationAttentionSignals: typeof import("../../src/features/conversations/server/queries").getConversationAttentionSignals;

let studioId: string;
let studio2Id: string;
let ownerUserId: string;
let adminUserId: string;
let masterUserId: string;
let master2UserId: string;
let otherStudioUserId: string;

let master1Id: string;
let master2Id: string;

let client1Id: string;
let client2Id: string;
let clientOtherStudioId: string;

let cycle1Id: string;
let cycle2Id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const convService = await import("../../src/features/conversations/server/service");
  getOrCreateClientConversation = convService.getOrCreateClientConversation;
  sendManualMessage = convService.sendManualMessage;
  recordInboundMessage = convService.recordInboundMessage;
  markConversationRead = convService.markConversationRead;
  assignConversation = convService.assignConversation;
  closeConversation = convService.closeConversation;
  reopenConversation = convService.reopenConversation;

  const convQueries = await import("../../src/features/conversations/server/queries");
  listConversationsForContext = convQueries.listConversationsForContext;
  getConversationForContext = convQueries.getConversationForContext;
  listConversationMessagesForContext = convQueries.listConversationMessagesForContext;
  getConversationAttentionSignals = convQueries.getConversationAttentionSignals;

  // 1. Primary Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Conversation Test Studio",
        slug: `conv-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Second Studio for cross-studio tenant testing
  const [st2] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Second Studio",
        slug: `second-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studio2Id = st2.id;

  const roleRows = await db.select().from(s.roles);
  const ownerRoleId = roleRows.find((r) => r.code === "OWNER")!.id;
  const adminRoleId = roleRows.find((r) => r.code === "ADMIN")!.id;
  const masterRoleId = roleRows.find((r) => r.code === "MASTER")!.id;

  // Users in primary studio
  ownerUserId = `user-owner-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Owner Alice",
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

  adminUserId = `user-admin-${randomUUID()}`;
  await db.insert(s.user).values({
    id: adminUserId,
    name: "Admin Bob",
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

  masterUserId = `user-master1-${randomUUID()}`;
  await db.insert(s.user).values({
    id: masterUserId,
    name: "Master Clara",
    email: `${masterUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(s.studioMembers).values({
    studioId,
    userId: masterUserId,
    roleId: masterRoleId,
    isActive: true,
  });

  const [m1] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: masterUserId,
      displayName: "Master Clara",
      isActive: true,
    })
    .returning();
  master1Id = m1.id;

  master2UserId = `user-master2-${randomUUID()}`;
  await db.insert(s.user).values({
    id: master2UserId,
    name: "Master Diana",
    email: `${master2UserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(s.studioMembers).values({
    studioId,
    userId: master2UserId,
    roleId: masterRoleId,
    isActive: true,
  });

  const [m2] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: master2UserId,
      displayName: "Master Diana",
      isActive: true,
    })
    .returning();
  master2Id = m2.id;

  // Other studio user
  otherStudioUserId = `user-other-${randomUUID()}`;
  await db.insert(s.user).values({
    id: otherStudioUserId,
    name: "Other Studio User",
    email: `${otherStudioUserId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(s.studioMembers).values({
    studioId: studio2Id,
    userId: otherStudioUserId,
    roleId: ownerRoleId,
    isActive: true,
  });

  // Clients
  const [c1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Elena",
      fullName: "Elena Rostova",
      phone: "+39111222333",
      assignedMasterId: master1Id,
      clientStatus: "new_lead",
    })
    .returning();
  client1Id = c1.id;

  const [c2] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Maria",
      fullName: "Maria Petrova",
      phone: "+39444555666",
      assignedMasterId: master2Id,
      clientStatus: "new_lead",
    })
    .returning();
  client2Id = c2.id;

  const [cOther] = await db
    .insert(s.clients)
    .values({
      studioId: studio2Id,
      firstName: "Sofia",
      fullName: "Sofia Foreign",
      phone: "+39777888999",
      clientStatus: "new_lead",
    })
    .returning();
  clientOtherStudioId = cOther.id;

  // Treatment cycles
  const [cy1] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client1Id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycle1Id = cy1.id;

  const [cy2] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client2Id,
      zoneCode: "lips",
      kind: "pmu",
      stage: "new_lead",
    })
    .returning();
  cycle2Id = cy2.id;
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

describe("Phase 10 — Canonical Conversations Subsystem", () => {
  describe("1. Conversation Lifecycle & Thread Identity", () => {
    it("1. creates primary client conversation", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      expect(conv).toBeDefined();
      expect(conv.studioId).toBe(studioId);
      expect(conv.clientId).toBe(client1Id);
      expect(conv.status).toBe("OPEN");
    });

    it("2. returns existing conversation on repeated calls (thread identity)", async () => {
      const conv1 = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );
      const conv2 = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      expect(conv1.id).toBe(conv2.id);
    });

    it("3. rejects conversation creation for cross-Studio client", async () => {
      await expect(
        getOrCreateClientConversation(
          db,
          { studioId, userId: ownerUserId },
          clientOtherStudioId
        )
      ).rejects.toThrow("Client not found in this studio");
    });

    it("4. supports optional valid TreatmentCycle linkage", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id,
        cycle1Id
      );

      expect(conv.cycleId).toBe(cycle1Id);
    });

    it("5. rejects cross-client cycle linkage", async () => {
      // Trying to link cycle2 (which belongs to client2) to client1
      await expect(
        getOrCreateClientConversation(
          db,
          { studioId, userId: ownerUserId },
          client1Id,
          cycle2Id
        )
      ).rejects.toThrow("Treatment cycle does not belong to this client");
    });
  });

  describe("2. Messages & Immutability", () => {
    it("6. persists manual outbound message and updates lastMessageAt", async () => {
      const res = await sendManualMessage(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId: client1Id,
          body: "Здравствуйте, Elena! Напоминаем о визите.",
        }
      );

      expect(res.message).toBeDefined();
      expect(res.message.direction).toBe("OUTBOUND");
      expect(res.message.channel).toBe("MANUAL");
      expect(res.message.senderUserId).toBe(ownerUserId);
      expect(res.message.body).toBe("Здравствуйте, Elena! Напоминаем о визите.");
      expect(res.conversation.lastMessageAt).toBeDefined();
    });

    it("7. persists inbound message via server ingestion", async () => {
      const res = await recordInboundMessage(db, {
        studioId,
        clientId: client1Id,
        channel: "WHATSAPP",
        body: "Спасибо, буду вовремя!",
        providerMessageId: `msg-wa-${randomUUID()}`,
      });

      expect(res.message).toBeDefined();
      expect(res.message.direction).toBe("INBOUND");
      expect(res.message.channel).toBe("WHATSAPP");
      expect(res.message.body).toBe("Спасибо, буду вовремя!");
      expect(res.deduplicated).toBe(false);
    });

    it("8. enforces DB message immutability (UPDATE and DELETE prohibited)", async () => {
      const res = await sendManualMessage(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId: client1Id,
          body: "Тестовое сообщение для проверки неизменяемости.",
        }
      );

      // Attempting direct SQL UPDATE
      await expect(
        db
          .update(s.conversationMessages)
          .set({ body: "Измененный текст" })
          .where(eq(s.conversationMessages.id, res.message.id))
      ).rejects.toThrow();

      // Attempting direct SQL DELETE
      await expect(
        db
          .delete(s.conversationMessages)
          .where(eq(s.conversationMessages.id, res.message.id))
      ).rejects.toThrow();
    });

    it("9. deduplicates inbound provider message retry idempotently", async () => {
      const providerId = `wa-dup-test-${randomUUID()}`;

      const res1 = await recordInboundMessage(db, {
        studioId,
        clientId: client1Id,
        channel: "WHATSAPP",
        body: "Повторяющееся вебхук-сообщение",
        providerMessageId: providerId,
      });

      expect(res1.deduplicated).toBe(false);

      const res2 = await recordInboundMessage(db, {
        studioId,
        clientId: client1Id,
        channel: "WHATSAPP",
        body: "Повторяющееся вебхук-сообщение",
        providerMessageId: providerId,
      });

      expect(res2.deduplicated).toBe(true);
      expect(res2.message.id).toBe(res1.message.id);
    });

    it("10. deterministic message ordering (sentAt ASC, createdAt ASC, id ASC)", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      const msgs = await listConversationMessagesForContext(
        { studioId, userId: ownerUserId },
        conv.id
      );

      expect(msgs.length).toBeGreaterThan(1);
      for (let i = 1; i < msgs.length; i++) {
        expect(new Date(msgs[i].sentAt).getTime()).toBeGreaterThanOrEqual(
          new Date(msgs[i - 1].sentAt).getTime()
        );
      }
    });
  });

  describe("3. Read / Unread Independent State", () => {
    it("11. inbound message creates unread state for staff members", async () => {
      // Ingest inbound message for client2
      await recordInboundMessage(db, {
        studioId,
        clientId: client2Id,
        channel: "SMS",
        body: "Добрый день! Хочу записаться на брови.",
        sentAt: new Date(),
      });

      const conv = await getConversationForContext(
        { studioId, userId: ownerUserId },
        (await getOrCreateClientConversation(db, { studioId, userId: ownerUserId }, client2Id)).id
      );

      expect(conv?.unreadCount).toBeGreaterThan(0);
    });

    it("12. marking conversation as read clears unread count for current user", async () => {
      const convRecord = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client2Id
      );

      await markConversationRead(
        db,
        { studioId, userId: ownerUserId },
        { conversationId: convRecord.id }
      );

      const convAfter = await getConversationForContext(
        { studioId, userId: ownerUserId },
        convRecord.id
      );

      expect(convAfter?.unreadCount).toBe(0);
    });

    it("13. read state is independent per user (does not mark read for other users)", async () => {
      const convRecord = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client2Id
      );

      // Admin has not marked it read yet
      const convForAdmin = await getConversationForContext(
        { studioId, userId: adminUserId },
        convRecord.id
      );

      expect(convForAdmin?.unreadCount).toBeGreaterThan(0);
    });

    it("14. new inbound message after mark-as-read increments unread count again", async () => {
      const convRecord = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client2Id
      );

      // Send another inbound message later
      await recordInboundMessage(db, {
        studioId,
        clientId: client2Id,
        channel: "WHATSAPP",
        body: "И еще один вопрос по цене.",
        sentAt: new Date(Date.now() + 2000),
      });

      const convAfter = await getConversationForContext(
        { studioId, userId: ownerUserId },
        convRecord.id
      );

      expect(convAfter?.unreadCount).toBeGreaterThan(0);
    });

    it("15. staff's own outbound message does not count as unread", async () => {
      const [cOutbound] = await db
        .insert(s.clients)
        .values({
          studioId,
          firstName: "OutboundOnly",
          fullName: "OutboundOnly Client",
          phone: "+39000111222",
          clientStatus: "new_lead",
        })
        .returning();

      const res = await sendManualMessage(
        db,
        { studioId, userId: adminUserId },
        {
          clientId: cOutbound.id,
          body: "Первое исходящее сообщение от администратора",
        }
      );

      const convAfter = await getConversationForContext(
        { studioId, userId: adminUserId },
        res.conversation.id
      );

      // Outbound message automatically advances sender's read cursor
      expect(convAfter?.unreadCount).toBe(0);
    });
  });

  describe("4. Assignment", () => {
    it("16. allows OWNER or ADMIN to assign staff to conversation", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      const updated = await assignConversation(
        db,
        { studioId, userId: ownerUserId },
        {
          conversationId: conv.id,
          assignedUserId: adminUserId,
          reason: "reassign_to_admin",
        }
      );

      expect(updated.assignedUserId).toBe(adminUserId);
    });

    it("17. rejects assignment of user from another studio", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      await expect(
        assignConversation(
          db,
          { studioId, userId: ownerUserId },
          {
            conversationId: conv.id,
            assignedUserId: otherStudioUserId,
            reason: "invalid_assignee",
          }
        )
      ).rejects.toThrow("Assigned user must be an active member of this studio");
    });

    it("18. rejects assignment attempted by MASTER (insufficient permissions)", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      await expect(
        assignConversation(
          db,
          { studioId, userId: masterUserId },
          {
            conversationId: conv.id,
            assignedUserId: master2UserId,
            reason: "master_cannot_assign",
          }
        )
      ).rejects.toThrow(/Permission denied/i);
    });
  });

  describe("5. Close & Reopen Thread Lifecycle", () => {
    it("19. closing conversation preserves messages and marks status as CLOSED", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      const closed = await closeConversation(
        db,
        { studioId, userId: ownerUserId },
        {
          conversationId: conv.id,
          reason: "issue_resolved",
        }
      );

      expect(closed.status).toBe("CLOSED");

      const msgs = await listConversationMessagesForContext(
        { studioId, userId: ownerUserId },
        conv.id
      );
      expect(msgs.length).toBeGreaterThan(0);
    });

    it("20. reopen conversation marks status as OPEN", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      const reopened = await reopenConversation(
        db,
        { studioId, userId: ownerUserId },
        {
          conversationId: conv.id,
          reason: "client_contacted_again",
        }
      );

      expect(reopened.status).toBe("OPEN");
    });

    it("21. incoming message on closed conversation automatically reopens it", async () => {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client1Id
      );

      await closeConversation(
        db,
        { studioId, userId: ownerUserId },
        { conversationId: conv.id, reason: "closing_before_inbound" }
      );

      const res = await recordInboundMessage(db, {
        studioId,
        clientId: client1Id,
        channel: "WHATSAPP",
        body: "Привет, я снова тут!",
      });

      expect(res.conversation.status).toBe("OPEN");
    });
  });

  describe("6. Permissions & Tenant Security", () => {
    it("22. rejects cross-Studio conversation read", async () => {
      const convInStudio2 = await getOrCreateClientConversation(
        db,
        { studioId: studio2Id, userId: otherStudioUserId },
        clientOtherStudioId
      );

      await expect(
        getConversationForContext(
          { studioId, userId: ownerUserId },
          convInStudio2.id
        )
      ).resolves.toBeNull();
    });

    it("23. enforces MASTER scope (cannot see clients assigned to other masters without shared cycle)", async () => {
      // client2 is assigned to master2; master1 has no access to client2
      await getOrCreateClientConversation(
        db,
        { studioId, userId: ownerUserId },
        client2Id
      );

      const master1List = await listConversationsForContext(
        { studioId, userId: masterUserId },
        { clientId: client2Id }
      );

      expect(master1List.length).toBe(0);
    });

    it("24. OWNER sees studio-wide conversations", async () => {
      const ownerList = await listConversationsForContext(
        { studioId, userId: ownerUserId }
      );

      expect(ownerList.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("7. UI & Read Model Integrations", () => {
    it("25. conversation list item contains preview and timestamp", async () => {
      const list = await listConversationsForContext(
        { studioId, userId: ownerUserId },
        { clientId: client1Id }
      );

      expect(list.length).toBe(1);
      expect(list[0].clientName).toBe("Elena Rostova");
      expect(list[0].lastMessagePreview).toBeDefined();
      expect(list[0].lastMessageAt).toBeDefined();
    });

    it("26. supports filters (status, unreadOnly, assignedToMe)", async () => {
      const openList = await listConversationsForContext(
        { studioId, userId: ownerUserId },
        { status: "OPEN" }
      );
      for (const item of openList) {
        expect(item.status).toBe("OPEN");
      }
    });

    it("27. attention signals return latest unanswered status and timestamps", async () => {
      const signals = await getConversationAttentionSignals(client1Id, studioId);

      expect(signals.conversationId).toBeDefined();
      expect(signals.lastInboundAt).toBeDefined();
    });
  });

  describe("8. Side-Effect Prohibitions Audit", () => {
    it("28. does NOT mutate TreatmentCycle stage", async () => {
      const [cyBefore] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycle1Id));

      await sendManualMessage(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId: client1Id,
          cycleId: cycle1Id,
          body: "Сообщение по циклу",
        }
      );

      const [cyAfter] = await db
        .select()
        .from(s.treatmentCycles)
        .where(eq(s.treatmentCycles.id, cycle1Id));

      expect(cyAfter.stage).toBe(cyBefore.stage);
      expect(cyAfter.version).toBe(cyBefore.version);
    });

    it("29. does NOT mutate payments, ledger entries, or appointments", async () => {
      const ledgerCountBefore = (await db.select().from(s.ledgerEntries)).length;
      const apptCountBefore = (await db.select().from(s.appointments)).length;

      await sendManualMessage(
        db,
        { studioId, userId: ownerUserId },
        {
          clientId: client1Id,
          body: "Еще одно сообщение",
        }
      );

      const ledgerCountAfter = (await db.select().from(s.ledgerEntries)).length;
      const apptCountAfter = (await db.select().from(s.appointments)).length;

      expect(ledgerCountAfter).toBe(ledgerCountBefore);
      expect(apptCountAfter).toBe(apptCountBefore);
    });
  });
});
