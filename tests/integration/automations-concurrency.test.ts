import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { executeAutomationJob } from "@/features/automations/server/executor";
import { dispatchAutomationTrigger } from "@/features/automations/server/engine";
import { parseLocalTimeToUtc } from "@/features/calendar/domain/timezone";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let studioId: string;
let ownerUserId: string;
let master1Id: string;
let client1Id: string;
let serviceId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  // 1. Studio with Europe/Rome timezone (CET/CEST with DST transitions)
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Automation Concurrency Studio",
        slug: `auto-conc-${randomUUID()}`,
        timezone: "Europe/Rome",
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Owner user
  const roles = await db.select().from(s.roles);
  const ownerRoleId = roles.find((r) => r.code === "OWNER")!.id;

  ownerUserId = `u-owner-${randomUUID()}`;
  await db.insert(s.user).values({
    id: ownerUserId,
    name: "Owner Auto",
    email: `${ownerUserId}@test.local`,
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

  // 3. Master & Client & Service
  const [m1] = await db
    .insert(s.masters)
    .values({ studioId, userId: ownerUserId, displayName: "Master Concurrency" })
    .returning();
  master1Id = m1.id;

  const [c1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Maria",
      lastName: "Rossi",
      fullName: "Maria Rossi",
      phone: "+393331234567",
      clientStatus: "new_lead",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  client1Id = c1.id;

  const [svc] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Permanent Brows",
      category: "brows",
      procedureType: "brows",
      priceCents: 2000000,
      durationMinutes: 120,
    })
    .returning();
  serviceId = svc.id;
});

afterAll(async () => {
  if (database) {
    await database.close();
  }
});

describe("Phase 11 — Automation Concurrency & Deterministic Worker Races", () => {
  it("two concurrent workers race for the same due job: exactly one claims and executes", async () => {
    // 1. Insert a pending due outbox job
    const [job] = await db
      .insert(s.outboxJobs)
      .values({
        studioId,
        handler: "automation.execute.v1",
        eventKey: `conc:claim:race:${randomUUID()}`,
        effectType: "transactional",
        state: "pending",
        availableAt: new Date(Date.now() - 5000),
        payload: { testJob: true },
        payloadHash: "hash-claim-race",
      })
      .returning();

    // 2. Worker A and Worker B try to claim the due job simultaneously using PostgreSQL FOR UPDATE SKIP LOCKED
    const claimJob = async () => {
      return db.transaction(async (tx) => {
        const [claimed] = await tx
          .select()
          .from(s.outboxJobs)
          .where(
            and(
              eq(s.outboxJobs.id, job.id),
              eq(s.outboxJobs.state, "pending"),
              sql`${s.outboxJobs.availableAt} <= now()`
            )
          )
          .limit(1)
          .for("update", { skipLocked: true });

        if (!claimed) return null;

        const token = randomUUID();
        const [updated] = await tx
          .update(s.outboxJobs)
          .set({
            state: "processing",
            attempts: claimed.attempts + 1,
            leaseToken: token,
            leaseUntil: new Date(Date.now() + 60000),
            updatedAt: new Date(),
          })
          .where(eq(s.outboxJobs.id, claimed.id))
          .returning();

        return updated;
      });
    };

    const [claimedA, claimedB] = await Promise.all([claimJob(), claimJob()]);

    // Exactly one worker must have claimed this job
    const claimAHasJob = claimedA?.id === job.id;
    const claimBHasJob = claimedB?.id === job.id;

    expect(Number(claimAHasJob) + Number(claimBHasJob)).toBe(1);
  });

  it("two separate due jobs are claimed and processed by parallel workers without conflict", async () => {
    const [job1] = await db
      .insert(s.outboxJobs)
      .values({
        studioId,
        handler: "automation.execute.v1",
        eventKey: `conc:parallel:1:${randomUUID()}`,
        effectType: "transactional",
        state: "pending",
        availableAt: new Date(Date.now() - 5000),
        payload: { jobNum: 1 },
        payloadHash: "hash-par-1",
      })
      .returning();

    const [job2] = await db
      .insert(s.outboxJobs)
      .values({
        studioId,
        handler: "automation.execute.v1",
        eventKey: `conc:parallel:2:${randomUUID()}`,
        effectType: "transactional",
        state: "pending",
        availableAt: new Date(Date.now() - 5000),
        payload: { jobNum: 2 },
        payloadHash: "hash-par-2",
      })
      .returning();

    const claimNextJob = async () => {
      return db.transaction(async (tx) => {
        const [claimed] = await tx
          .select()
          .from(s.outboxJobs)
          .where(
            and(
              eq(s.outboxJobs.studioId, studioId),
              eq(s.outboxJobs.state, "pending"),
              sql`${s.outboxJobs.availableAt} <= now()`
            )
          )
          .orderBy(asc(s.outboxJobs.id))
          .limit(1)
          .for("update", { skipLocked: true });

        if (!claimed) return null;

        const token = randomUUID();
        const [updated] = await tx
          .update(s.outboxJobs)
          .set({
            state: "processing",
            attempts: claimed.attempts + 1,
            leaseToken: token,
            leaseUntil: new Date(Date.now() + 60000),
            updatedAt: new Date(),
          })
          .where(eq(s.outboxJobs.id, claimed.id))
          .returning();

        return updated;
      });
    };

    const [claimed1, claimed2] = await Promise.all([claimNextJob(), claimNextJob()]);

    expect(claimed1).toBeDefined();
    expect(claimed2).toBeDefined();
    expect([job1.id, job2.id]).toContain(claimed1?.id);
    expect([job1.id, job2.id]).toContain(claimed2?.id);
    expect(claimed1?.id).not.toBe(claimed2?.id);
  });

  it("duplicate source event with same rule produces at most one outbox job (idempotent deduplication)", async () => {
    // Create rule
    const [rule] = await db
      .insert(s.automationRules)
      .values({
        studioId,
        code: `dedup_rule_${randomUUID().slice(0, 8)}`,
        name: "Dedup Test Rule",
        enabled: true,
        triggerType: "APPOINTMENT_CREATED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        config: { offsetMinutes: -120 },
      })
      .returning();

    const startsAt = new Date(Date.now() + 24 * 3600 * 1000);

    const [appt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId: client1Id,
        masterId: master1Id,
        serviceId: serviceId,
        startAt: startsAt,
        endAt: new Date(startsAt.getTime() + 3600 * 1000),
        status: "confirmed",
        source: "phone",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 2000000,
        durationSnapshotMinutes: 120,
      })
      .returning();

    // Trigger dispatch twice with exact same event parameters
    await db.transaction(async (tx) => {
      await dispatchAutomationTrigger(tx, { studioId }, {
        type: "APPOINTMENT_CREATED",
        studioId,
        entityType: "appointment",
        entityId: appt.id,
        clientId: client1Id,
        referenceTime: startsAt,
      });
    });

    await db.transaction(async (tx) => {
      await dispatchAutomationTrigger(tx, { studioId }, {
        type: "APPOINTMENT_CREATED",
        studioId,
        entityType: "appointment",
        entityId: appt.id,
        clientId: client1Id,
        referenceTime: startsAt,
      });
    });

    // Verify outbox jobs for this specific rule and appointment
    const eventKeyPrefix = `auto:${rule.code}:appointment:${appt.id}`;
    const matchingJobs = await db
      .select()
      .from(s.outboxJobs)
      .where(and(eq(s.outboxJobs.studioId, studioId), eq(s.outboxJobs.eventKey, `${eventKeyPrefix}:${startsAt.toISOString()}`)));

    expect(matchingJobs.length).toBe(1);
  });

  it("cancellation racing worker execution suppresses stale reminder safely", async () => {
    // 1. Create appointment
    const startsAt = new Date(Date.now() + 10 * 3600 * 1000);
    const [appt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId: client1Id,
        masterId: master1Id,
        serviceId: serviceId,
        startAt: startsAt,
        endAt: new Date(startsAt.getTime() + 3600 * 1000),
        status: "confirmed",
        source: "phone",
        createdById: ownerUserId,
        serviceSnapshot: {},
        clientSnapshot: {},
        masterSnapshot: {},
        priceSnapshotCents: 2000000,
        durationSnapshotMinutes: 120,
      })
      .returning();

    const [exec] = await db
      .insert(s.automationExecutions)
      .values({
        studioId,
        triggerType: "APPOINTMENT_CREATED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        entityType: "appointment",
        entityId: appt.id,
        status: "scheduled",
      })
      .returning();

    // 2. Appointment is cancelled in DB
    await db.update(s.appointments).set({ status: "cancelled" }).where(eq(s.appointments.id, appt.id));

    // 3. Worker attempts execution on the cancelled appointment
    const res = await db.transaction(async (tx) => {
      return executeAutomationJob(tx, studioId, {
        executionId: exec.id,
        ruleId: randomUUID(),
        ruleCode: "race_cancel_rule",
        triggerType: "APPOINTMENT_CREATED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        entityType: "appointment",
        entityId: appt.id,
        clientId: client1Id,
        scheduledFor: new Date().toISOString(),
        config: {},
      });
    });

    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("appointment_cancelled");

    // No tasks created for cancelled appointment
    const createdTasks = await db
      .select()
      .from(s.tasks)
      .where(and(eq(s.tasks.studioId, studioId), eq(s.tasks.appointmentId, appt.id)));

    expect(createdTasks.length).toBe(0);
  });

  it("inbound message follow-up job is safely suppressed when staff reply arrives", async () => {
    // 1. Create conversation
    const [conv] = await db
      .insert(s.conversations)
      .values({
        studioId,
        clientId: client1Id,
        status: "OPEN",
        lastMessageAt: new Date(),
      })
      .returning();

    const [exec] = await db
      .insert(s.automationExecutions)
      .values({
        studioId,
        triggerType: "CONVERSATION_INBOUND_RECEIVED",
        actionType: "CREATE_CONVERSATION_FOLLOW_UP",
        entityType: "conversation",
        entityId: conv.id,
        status: "scheduled",
      })
      .returning();

    // 2. Staff replies with OUTBOUND message
    await db.insert(s.conversationMessages).values({
      studioId,
      conversationId: conv.id,
      clientId: client1Id,
      direction: "OUTBOUND",
      channel: "MANUAL",
      body: "Добрый день! Чем можем помочь?",
      senderUserId: ownerUserId,
      sentAt: new Date(Date.now() + 1000),
    });

    // 3. Worker executes follow-up job
    const res = await db.transaction(async (tx) => {
      return executeAutomationJob(tx, studioId, {
        executionId: exec.id,
        ruleId: randomUUID(),
        ruleCode: "conv_unanswered_check",
        triggerType: "CONVERSATION_INBOUND_RECEIVED",
        actionType: "CREATE_CONVERSATION_FOLLOW_UP",
        entityType: "conversation",
        entityId: conv.id,
        clientId: client1Id,
        scheduledFor: new Date().toISOString(),
        config: {},
        metadata: { triggerTime: new Date(Date.now() - 60000).toISOString() },
      });
    });

    expect(res.status).toBe("skipped");
    expect(res.reason).toBe("conversation_already_answered_by_staff");
  });

  it("resolves timezone offsets across daylight saving time (DST) transitions accurately", () => {
    // Studio is in Europe/Rome
    // DST transition in 2026: March 29 (CET UTC+1 -> CEST UTC+2)
    const winterUtc = parseLocalTimeToUtc("2026-01-15", "10:00", "Europe/Rome");
    // In winter, Rome is UTC+1 -> 10:00 Rome is 09:00 UTC
    expect(winterUtc.toISOString()).toBe("2026-01-15T09:00:00.000Z");

    const summerUtc = parseLocalTimeToUtc("2026-07-15", "10:00", "Europe/Rome");
    // In summer (CEST), Rome is UTC+2 -> 10:00 Rome is 08:00 UTC
    expect(summerUtc.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });
});
