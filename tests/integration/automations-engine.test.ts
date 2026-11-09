import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  dispatchAutomationTrigger,
  cancelPendingAutomations,
} from "@/features/automations/server/engine";
import { executeAutomationJob } from "@/features/automations/server/executor";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
  role: "OWNER" as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.id ? { user: { id: session.id, role: session.role } } : null),
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

let createAutomationRuleAction: typeof import("@/features/automations/server/actions").createAutomationRuleAction;
let toggleAutomationRuleAction: typeof import("@/features/automations/server/actions").toggleAutomationRuleAction;
let seedDefaultRulesAction: typeof import("@/features/automations/server/actions").seedDefaultRulesAction;
let retryAutomationJobAction: typeof import("@/features/automations/server/actions").retryAutomationJobAction;
let cancelAutomationJobAction: typeof import("@/features/automations/server/actions").cancelAutomationJobAction;

let getAutomationRules: typeof import("@/features/automations/server/queries").getAutomationRules;
let getAutomationJobs: typeof import("@/features/automations/server/queries").getAutomationJobs;
let getAutomationExecutions: typeof import("@/features/automations/server/queries").getAutomationExecutions;
let getAutomationStats: typeof import("@/features/automations/server/queries").getAutomationStats;

let studioId: string;
let studio2Id: string;
let ownerUserId: string;
let adminUserId: string;
let masterUserId: string;
let clientUserId: string;

let master1Id: string;
let client1Id: string;
let service1Id: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const actions = await import("@/features/automations/server/actions");
  createAutomationRuleAction = actions.createAutomationRuleAction;
  toggleAutomationRuleAction = actions.toggleAutomationRuleAction;
  seedDefaultRulesAction = actions.seedDefaultRulesAction;
  retryAutomationJobAction = actions.retryAutomationJobAction;
  cancelAutomationJobAction = actions.cancelAutomationJobAction;

  const queries = await import("@/features/automations/server/queries");
  getAutomationRules = queries.getAutomationRules;
  getAutomationJobs = queries.getAutomationJobs;
  getAutomationExecutions = queries.getAutomationExecutions;
  getAutomationStats = queries.getAutomationStats;

  // 1. Setup Studio
  const [st] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Automation Test Studio",
        slug: `auto-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studioId = st.id;

  // 2. Setup Studio 2 for tenant isolation checks
  const [st2] = await db
    .insert(s.studios)
    .values([
      {
        ...studioFixture(),
        name: "Other Studio",
        slug: `other-studio-${randomUUID()}`,
      },
    ])
    .returning();
  studio2Id = st2.id;

  // 3. Setup Users & Roles
  ownerUserId = `u-owner-${randomUUID()}`;
  adminUserId = `u-admin-${randomUUID()}`;
  masterUserId = `u-master-${randomUUID()}`;
  clientUserId = `u-client-${randomUUID()}`;

  await db.insert(s.user).values([
    { id: ownerUserId, name: "Studio Owner", email: `${ownerUserId}@test.local`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: adminUserId, name: "Studio Admin", email: `${adminUserId}@test.local`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: masterUserId, name: "Studio Master", email: `${masterUserId}@test.local`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: clientUserId, name: "Client User", email: `${clientUserId}@test.local`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
  ]);

  const roles = await db.select().from(s.roles);
  const ownerRoleId = roles.find((r) => r.code === "OWNER")!.id;
  const adminRoleId = roles.find((r) => r.code === "ADMIN")!.id;
  const masterRoleId = roles.find((r) => r.code === "MASTER")!.id;

  await db.insert(s.studioMembers).values([
    { studioId, userId: ownerUserId, roleId: ownerRoleId, isActive: true },
    { studioId, userId: adminUserId, roleId: adminRoleId, isActive: true },
    { studioId, userId: masterUserId, roleId: masterRoleId, isActive: true },
  ]);

  // 4. Create Master & Client & Cycle & Service
  const [m1] = await db
    .insert(s.masters)
    .values({ studioId, userId: masterUserId, displayName: "Elena Brows" })
    .returning();
  master1Id = m1.id;

  const [c1] = await db
    .insert(s.clients)
    .values({
      studioId,
      firstName: "Anna",
      lastName: "Ivanova",
      fullName: "Anna Ivanova",
      phone: `+7999${Math.floor(Math.random() * 8999999 + 1000000)}`,
      clientStatus: "new_lead",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  client1Id = c1.id;

  await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client1Id,
      assignedMasterId: master1Id,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    });

  const [svc1] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Перманент бровей",
      category: "brows",
      procedureType: "brows",
      priceCents: 1500000,
      durationMinutes: 120,
    })
    .returning();
  service1Id = svc1.id;
});

afterAll(async () => {
  if (database) {
    await database.close();
  }
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
  session.role = "OWNER";
});

describe("Phase 11 — Automation Engine & Outbox Integration Tests", () => {
  describe("1. Automation Rule Management", () => {
    it("creates a valid automation rule", async () => {
      const res = await createAutomationRuleAction({
        code: "test_appt_reminder_24h",
        name: "Тестовое напоминание за 24ч",
        description: "Напоминание перед записью",
        enabled: true,
        triggerType: "APPOINTMENT_CREATED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        config: { offsetMinutes: -1440, titleTemplate: "Завтра запись" },
      });

      expect(res.success).toBe(true);
      expect(res.rule.code).toBe("test_appt_reminder_24h");
      expect(res.rule.studioId).toBe(studioId);
    });

    it("rejects invalid rule configuration for trigger", async () => {
      await expect(
        createAutomationRuleAction({
          code: "test_invalid_config",
          name: "Invalid Rule",
          enabled: true,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          config: { offsetMinutes: "not-a-number" },
        })
      ).rejects.toThrow();
    });

    it("disables and enables rule via toggle action", async () => {
      const [rule] = await db
        .select()
        .from(s.automationRules)
        .where(
          and(
            eq(s.automationRules.studioId, studioId),
            eq(s.automationRules.code, "test_appt_reminder_24h")
          )
        );

      expect(rule).toBeDefined();

      const toggleOff = await toggleAutomationRuleAction(rule.id, false);
      expect(toggleOff.rule.enabled).toBe(false);

      const toggleOn = await toggleAutomationRuleAction(rule.id, true);
      expect(toggleOn.rule.enabled).toBe(true);
    });

    it("seeds default standard automation rules", async () => {
      const res = await seedDefaultRulesAction();
      expect(res.success).toBe(true);

      const rules = await db
        .select()
        .from(s.automationRules)
        .where(eq(s.automationRules.studioId, studioId));

      expect(rules.length).toBeGreaterThanOrEqual(4);
    });

    it("enforces tenant isolation across studios for rules", async () => {
      session.studioId = studio2Id;
      session.id = ownerUserId;

      await expect(getAutomationRules()).rejects.toThrow("Permission denied");
    });
  });

  describe("2. Trigger Dispatch & Outbox Scheduling", () => {
    it("dispatches APPOINTMENT_CREATED and enqueues scheduled outbox jobs", async () => {
      session.studioId = studioId;
      session.id = ownerUserId;

      // Create an appointment 48 hours in the future
      const startsAt = new Date(Date.now() + 48 * 3600 * 1000);
      const endsAt = new Date(startsAt.getTime() + 2 * 3600 * 1000);

      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId,
          clientId: client1Id,
          masterId: master1Id,
          serviceId: service1Id,
          startAt: startsAt,
          endAt: endsAt,
          status: "confirmed",
          source: "phone",
          createdById: ownerUserId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1500000,
          durationSnapshotMinutes: 120,
        })
        .returning();

      // Trigger dispatch
      const scheduled = await db.transaction(async (tx) => {
        return dispatchAutomationTrigger(tx, { studioId }, {
          type: "APPOINTMENT_CREATED",
          studioId,
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          referenceTime: startsAt,
        });
      });

      expect(scheduled.length).toBeGreaterThan(0);

      // Verify outbox jobs exist
      const jobs = await db
        .select()
        .from(s.outboxJobs)
        .where(and(eq(s.outboxJobs.studioId, studioId), eq(s.outboxJobs.handler, "automation.execute.v1")));

      expect(jobs.length).toBeGreaterThan(0);
      const reminderJob = jobs.find((j) => (j.payload as Record<string, unknown>).entityId === appt.id);
      expect(reminderJob).toBeDefined();
      expect(reminderJob!.state).toBe("pending");
    });

    it("rescheduling appointment invalidates old reminders and schedules new ones", async () => {
      // Create a reschedule rule
      await createAutomationRuleAction({
        code: "test_reschedule_reminder_24h",
        name: "Напоминание при переносе",
        enabled: true,
        triggerType: "APPOINTMENT_RESCHEDULED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        config: { offsetMinutes: -1440, titleTemplate: "Перенесенная запись" },
      });

      const startsAt = new Date(Date.now() + 30 * 3600 * 1000);
      const endsAt = new Date(startsAt.getTime() + 2 * 3600 * 1000);

      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId,
          clientId: client1Id,
          masterId: master1Id,
          serviceId: service1Id,
          startAt: startsAt,
          endAt: endsAt,
          status: "confirmed",
          source: "phone",
          createdById: ownerUserId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1500000,
          durationSnapshotMinutes: 120,
        })
        .returning();

      // Initial schedule
      await db.transaction(async (tx) => {
        return dispatchAutomationTrigger(tx, { studioId }, {
          type: "APPOINTMENT_CREATED",
          studioId,
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          referenceTime: startsAt,
        });
      });

      // Reschedule: cancel old and schedule new
      const newStartsAt = new Date(Date.now() + 60 * 3600 * 1000);
      await db.transaction(async (tx) => {
        await cancelPendingAutomations(tx, studioId, {
          entityType: "appointment",
          entityId: appt.id,
          reason: "rescheduled",
        });

        await dispatchAutomationTrigger(tx, { studioId }, {
          type: "APPOINTMENT_RESCHEDULED",
          studioId,
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          referenceTime: newStartsAt,
        });
      });

      // Check executions: previous cancelled, new scheduled
      const executions = await db
        .select()
        .from(s.automationExecutions)
        .where(
          and(
            eq(s.automationExecutions.studioId, studioId),
            eq(s.automationExecutions.entityId, appt.id)
          )
        );

      const cancelled = executions.filter((e) => e.status === "cancelled");
      const active = executions.filter((e) => e.status === "scheduled");

      expect(cancelled.length).toBeGreaterThan(0);
      expect(active.length).toBeGreaterThan(0);
    });

    it("cancelling appointment cancels all pending reminder jobs", async () => {
      const startsAt = new Date(Date.now() + 20 * 3600 * 1000);

      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId,
          clientId: client1Id,
          masterId: master1Id,
          serviceId: service1Id,
          startAt: startsAt,
          endAt: new Date(startsAt.getTime() + 3600 * 1000),
          status: "confirmed",
          source: "phone",
          createdById: ownerUserId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1500000,
          durationSnapshotMinutes: 120,
        })
        .returning();

      await db.transaction(async (tx) => {
        return dispatchAutomationTrigger(tx, { studioId }, {
          type: "APPOINTMENT_CREATED",
          studioId,
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          referenceTime: startsAt,
        });
      });

      // Cancel appointment
      await db.transaction(async (tx) => {
        await cancelPendingAutomations(tx, studioId, {
          entityType: "appointment",
          entityId: appt.id,
          reason: "cancelled",
        });
      });

      const executions = await db
        .select()
        .from(s.automationExecutions)
        .where(
          and(
            eq(s.automationExecutions.studioId, studioId),
            eq(s.automationExecutions.entityId, appt.id)
          )
        );

      expect(executions.every((e) => e.status === "cancelled")).toBe(true);
    });
  });

  describe("3. Worker Execution & Idempotency", () => {
    it("executes due job and generates operational task without external side effects", async () => {
      // Create a ready job (availableAt = now - 1 minute)
      const startsAt = new Date(Date.now() + 3600 * 1000);

      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId,
          clientId: client1Id,
          masterId: master1Id,
          serviceId: service1Id,
          startAt: startsAt,
          endAt: new Date(startsAt.getTime() + 3600 * 1000),
          status: "confirmed",
          source: "phone",
          createdById: ownerUserId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1500000,
          durationSnapshotMinutes: 120,
        })
        .returning();

      // Enqueue job with availableAt in the past so worker claims it immediately
      const [execution] = await db
        .insert(s.automationExecutions)
        .values({
          studioId,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "appointment",
          entityId: appt.id,
          status: "scheduled",
          scheduledFor: new Date(Date.now() - 60000),
        })
        .returning();

      const [job] = await db
        .insert(s.outboxJobs)
        .values({
          studioId,
          handler: "automation.execute.v1",
          eventKey: `test:ready:job:${randomUUID()}`,
          effectType: "transactional",
          availableAt: new Date(Date.now() - 60000),
          payload: {
            executionId: execution.id,
            ruleId: randomUUID(),
            ruleCode: "appointment_reminder_test",
            triggerType: "APPOINTMENT_CREATED",
            actionType: "CREATE_OPERATIONAL_REMINDER",
            entityType: "appointment",
            entityId: appt.id,
            clientId: client1Id,
            scheduledFor: new Date().toISOString(),
            config: { titleTemplate: "Срочное напоминание", priority: "high" },
          },
          payloadHash: "hash123",
        })
        .returning();

      await db
        .update(s.automationExecutions)
        .set({ jobId: job.id })
        .where(eq(s.automationExecutions.id, execution.id));

      // Execute the automation job
      const execResult = await db.transaction(async (tx) => {
        return executeAutomationJob(tx, studioId, {
          executionId: execution.id,
          ruleId: randomUUID(),
          ruleCode: "appointment_reminder_test",
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          scheduledFor: new Date().toISOString(),
          config: { titleTemplate: "Срочное напоминание", priority: "high" },
        });
      });

      expect(execResult.status).toBe("succeeded");

      // Verify execution updated to succeeded
      const [updatedExec] = await db
        .select()
        .from(s.automationExecutions)
        .where(eq(s.automationExecutions.id, execution.id));

      expect(updatedExec.status).toBe("succeeded");
      expect(updatedExec.executedAt).toBeDefined();

      // Verify operational task was created in tasks table
      const createdTasks = await db
        .select()
        .from(s.tasks)
        .where(and(eq(s.tasks.studioId, studioId), eq(s.tasks.appointmentId, appt.id)));

      expect(createdTasks.length).toBeGreaterThan(0);
      expect(createdTasks[0].title).toBe("Срочное напоминание");
    });

    it("safely skips execution if target entity was cancelled or deleted", async () => {
      // Create cancelled appointment
      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId,
          clientId: client1Id,
          masterId: master1Id,
          serviceId: service1Id,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3600 * 1000),
          status: "cancelled",
          source: "phone",
          createdById: ownerUserId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1500000,
          durationSnapshotMinutes: 120,
        })
        .returning();

      const [execution] = await db
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

      const result = await db.transaction(async (tx) => {
        return executeAutomationJob(tx, studioId, {
          executionId: execution.id,
          ruleId: randomUUID(),
          ruleCode: "reminder_skip_test",
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "appointment",
          entityId: appt.id,
          clientId: client1Id,
          scheduledFor: new Date().toISOString(),
          config: {},
        });
      });

      expect(result.status).toBe("skipped");

      const [updatedExec] = await db
        .select()
        .from(s.automationExecutions)
        .where(eq(s.automationExecutions.id, execution.id));

      expect(updatedExec.status).toBe("skipped");
    });

    it("retry action resets job to pending for re-execution", async () => {
      const [deadJob] = await db
        .insert(s.outboxJobs)
        .values({
          studioId,
          handler: "automation.execute.v1",
          eventKey: `test:dead:job:${randomUUID()}`,
          effectType: "transactional",
          state: "dead",
          attempts: 5,
          lastError: "transient_failure",
          payload: { test: true },
          payloadHash: "deadhash",
        })
        .returning();

      const retryRes = await retryAutomationJobAction(deadJob.id);
      expect(retryRes.success).toBe(true);
      expect(retryRes.job.state).toBe("pending");
      expect(retryRes.job.attempts).toBe(0);
      expect(retryRes.job.lastError).toBeNull();
    });

    it("cancel action marks job dead and execution cancelled", async () => {
      const [job] = await db
        .insert(s.outboxJobs)
        .values({
          studioId,
          handler: "automation.execute.v1",
          eventKey: `test:cancel:job:${randomUUID()}`,
          effectType: "transactional",
          state: "pending",
          payload: { test: true },
          payloadHash: "cancelhash",
        })
        .returning();

      const [exec] = await db
        .insert(s.automationExecutions)
        .values({
          studioId,
          jobId: job.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "appointment",
          entityId: randomUUID(),
          status: "scheduled",
        })
        .returning();

      const cancelRes = await cancelAutomationJobAction(job.id);
      expect(cancelRes.success).toBe(true);

      const [updatedJob] = await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.id, job.id));
      const [updatedExec] = await db.select().from(s.automationExecutions).where(eq(s.automationExecutions.id, exec.id));

      expect(updatedJob.state).toBe("dead");
      expect(updatedExec.status).toBe("cancelled");
    });
  });

  describe("4. Security & Permissions", () => {
    it("MASTER cannot create or manage automation rules", async () => {
      session.id = masterUserId;
      session.role = "MASTER";

      await expect(
        createAutomationRuleAction({
          code: "unauthorized_rule",
          name: "Rule by Master",
          enabled: true,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          config: {},
        })
      ).rejects.toThrow("Permission denied");
    });

    it("MASTER can read automations dashboard data", async () => {
      session.id = masterUserId;
      session.role = "MASTER";

      const rules = await getAutomationRules();
      expect(Array.isArray(rules)).toBe(true);

      const stats = await getAutomationStats();
      expect(stats).toHaveProperty("totalRules");
    });
  });

  describe("5. UI Read Models & Queries", () => {
    it("returns stats and execution history accurately", async () => {
      session.id = ownerUserId;
      session.role = "OWNER";

      const stats = await getAutomationStats();
      expect(stats.totalRules).toBeGreaterThan(0);

      const executions = await getAutomationExecutions({ limit: 10 });
      expect(Array.isArray(executions)).toBe(true);

      const jobs = await getAutomationJobs({ limit: 10 });
      expect(Array.isArray(jobs)).toBe(true);
    });
  });
});
