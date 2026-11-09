import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
  role: null as string | null,
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

describe("Phase 15: Operations & Observability Integration Tests (Test Matrix #1-#22, #31-#32)", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof import("@/db").db;

  let checkDatabaseHealth: typeof import("@/server/observability/metrics").checkDatabaseHealth;
  let getOutboxMetrics: typeof import("@/server/observability/metrics").getOutboxMetrics;
  let getAutomationMetrics: typeof import("@/server/observability/metrics").getAutomationMetrics;
  let getGoogleCalendarMetrics: typeof import("@/server/observability/metrics").getGoogleCalendarMetrics;
  let getAiMetrics: typeof import("@/server/observability/metrics").getAiMetrics;
  let getOperationalMetricsSummary: typeof import("@/server/observability/metrics").getOperationalMetricsSummary;

  let recordWorkerHeartbeat: typeof import("@/server/events/heartbeat").recordWorkerHeartbeat;
  let getWorkerHeartbeats: typeof import("@/server/events/heartbeat").getWorkerHeartbeats;

  let getOperationsDashboardData: typeof import("@/features/operations/server/queries").getOperationsDashboardData;
  let retryOutboxJob: typeof import("@/features/operations/server/actions").retryOutboxJob;
  let retryAutomationExecution: typeof import("@/features/operations/server/actions").retryAutomationExecution;
  let reconcileGoogleCalendarConnection: typeof import("@/features/operations/server/actions").reconcileGoogleCalendarConnection;

  let studioAId: string;
  let studioBId: string;
  let ownerAId: string;
  let adminAId: string;
  let masterAId: string;
  let userBId: string;

  const roleIds = new Map<string, string>();

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    db = (await import("@/db")).db;

    const metricsMod = await import("@/server/observability/metrics");
    checkDatabaseHealth = metricsMod.checkDatabaseHealth;
    getOutboxMetrics = metricsMod.getOutboxMetrics;
    getAutomationMetrics = metricsMod.getAutomationMetrics;
    getGoogleCalendarMetrics = metricsMod.getGoogleCalendarMetrics;
    getAiMetrics = metricsMod.getAiMetrics;
    getOperationalMetricsSummary = metricsMod.getOperationalMetricsSummary;

    const heartbeatMod = await import("@/server/events/heartbeat");
    recordWorkerHeartbeat = heartbeatMod.recordWorkerHeartbeat;
    getWorkerHeartbeats = heartbeatMod.getWorkerHeartbeats;

    const queriesMod = await import("@/features/operations/server/queries");
    getOperationsDashboardData = queriesMod.getOperationsDashboardData;

    const actionsMod = await import("@/features/operations/server/actions");
    retryOutboxJob = actionsMod.retryOutboxJob;
    retryAutomationExecution = actionsMod.retryAutomationExecution;
    reconcileGoogleCalendarConnection = actionsMod.reconcileGoogleCalendarConnection;

    // Create Studios
    [studioAId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
    [studioBId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);

    // Fetch Roles
    for (const role of await db.select().from(s.roles)) roleIds.set(role.code, role.id);

    // Create Users
    ownerAId = randomUUID();
    adminAId = randomUUID();
    masterAId = randomUUID();
    userBId = randomUUID();

    session.id = ownerAId;
    session.studioId = studioAId;
    session.role = "OWNER";

    await db.insert(s.user).values([
      { id: ownerAId, name: "Owner A", email: `${ownerAId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: adminAId, name: "Admin A", email: `${adminAId}@example.test`, role: "STUDIO_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: masterAId, name: "Master A", email: `${masterAId}@example.test`, role: "MASTER", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: userBId, name: "User B", email: `${userBId}@example.test`, role: "STUDIO_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    ]);

    await db.insert(s.studioMembers).values([
      { userId: ownerAId, studioId: studioAId, roleId: roleIds.get("OWNER")!, isActive: true },
      { userId: adminAId, studioId: studioAId, roleId: roleIds.get("ADMIN")!, isActive: true },
      { userId: masterAId, studioId: studioAId, roleId: roleIds.get("MASTER")!, isActive: true },
      { userId: userBId, studioId: studioBId, roleId: roleIds.get("OWNER")!, isActive: true },
    ]);
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(() => {
    session.id = ownerAId;
    session.studioId = studioAId;
    session.role = "OWNER";
  });

  describe("1. Database Health & System Readiness (Test Matrix #1 - #4)", () => {
    it("reports healthy when database is reachable (Test Matrix #1)", async () => {
      const dbHealth = await checkDatabaseHealth();
      expect(dbHealth.status).toBe("connected");
      expect(dbHealth.latencyMs).toBeGreaterThanOrEqual(0);
      expect(dbHealth.migrationHead).toBeDefined();

      const summary = await getOperationalMetricsSummary(studioAId);
      expect(summary.readiness.status).toBe("healthy");
      expect(summary.liveness.status).toBe("healthy");
    });

    it("evaluates Google degradation as non-fatal to overall CRM readiness (Test Matrix #3)", async () => {
      // Insert connection with needs_reauth in Studio A
      await db.insert(s.googleCalendarConnections).values({
        studioId: studioAId,
        userId: ownerAId,
        calendarId: "cal-deg-1",
        status: "needs_reauth",
        syncStatus: "error",
        lastError: "Invalid grant token expired",
      });

      const summary = await getOperationalMetricsSummary(studioAId);
      expect(summary.integrations.googleCalendar.status).toBe("degraded");
      expect(summary.readiness.status).toBe("healthy"); // DB is still reachable => ready
      expect(summary.overallStatus).toBe("degraded");
    });

    it("evaluates AI provider failure as non-fatal degradation (Test Matrix #4)", async () => {
      // Insert several failed AI runs
      for (let i = 0; i < 6; i++) {
        await db.insert(s.aiRuns).values({
          studioId: studioAId,
          userId: ownerAId,
          feature: "client_summary",
          entityType: "client",
          entityId: randomUUID(),
          status: "failed",
          error: "AI_TIMEOUT",
          provider: "mock",
          model: "mock-v1",
          promptVersion: "1.0",
        });
      }

      const summary = await getOperationalMetricsSummary(studioAId);
      expect(summary.integrations.ai.status).toBe("degraded");
      expect(summary.alerts.aiFailureSpike).toBe(true);
      expect(summary.readiness.status).toBe("healthy");
    });
  });

  describe("2. Outbox Observability & Lag Calculations (Test Matrix #5 - #9)", () => {
    it("counts pending jobs and correctly computes runnable outbox lag (Test Matrix #5, #7)", async () => {
      // Insert runnable pending job created 120 seconds ago
      const twoMinAgo = new Date(Date.now() - 120 * 1000);
      await db.insert(s.outboxJobs).values({
        studioId: studioAId,
        eventKey: "evt-lag-1",
        handler: "notifications.send",
        state: "pending",
        payload: { test: true },
        payloadHash: "hash-lag-1",
        availableAt: twoMinAgo,
        createdAt: twoMinAgo,
      });

      const metrics = await getOutboxMetrics(studioAId);
      expect(metrics.pendingCount).toBeGreaterThanOrEqual(1);
      expect(metrics.outboxLagSeconds).toBeGreaterThanOrEqual(119);
    });

    it("does NOT count future scheduled jobs as outbox lag (Test Matrix #6)", async () => {
      // Clean previous outbox jobs for studio B
      await db.delete(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioBId));

      // Insert job scheduled 1 hour in the future
      const oneHourFuture = new Date(Date.now() + 3600 * 1000);
      await db.insert(s.outboxJobs).values({
        studioId: studioBId,
        eventKey: "evt-future-1",
        handler: "automations.execute",
        state: "pending",
        payload: { future: true },
        payloadHash: "hash-fut-1",
        availableAt: oneHourFuture,
        createdAt: new Date(),
      });

      const metrics = await getOutboxMetrics(studioBId);
      expect(metrics.pendingCount).toBe(1);
      expect(metrics.outboxLagSeconds).toBe(0); // Lag is zero!
    });

    it("surfaces dead jobs and expired leases as stuck jobs (Test Matrix #8, #9)", async () => {
      // 1. Dead job
      await db.insert(s.outboxJobs).values({
        studioId: studioAId,
        eventKey: "evt-dead-1",
        handler: "notifications.send",
        state: "dead",
        payload: {},
        payloadHash: "hash-dead-1",
        attempts: 8,
        maxAttempts: 8,
        lastError: "attempts_exhausted",
      });

      // 2. Expired lease job (state='processing' with leaseUntil in past)
      const token = randomUUID();
      await db.insert(s.outboxJobs).values({
        studioId: studioAId,
        eventKey: "evt-lease-1",
        handler: "notifications.send",
        state: "processing",
        payload: {},
        payloadHash: "hash-lease-1",
        leaseToken: token,
        leaseUntil: new Date(Date.now() - 60 * 1000), // expired 1 min ago
        attempts: 1,
      });

      const metrics = await getOutboxMetrics(studioAId);
      expect(metrics.failedDeadCount).toBeGreaterThanOrEqual(1);
      expect(metrics.stuckJobsCount).toBeGreaterThanOrEqual(2);

      const leaseJob = metrics.stuckJobs.find((j) => j.reason === "lease_expired");
      expect(leaseJob).toBeDefined();

      const deadJob = metrics.stuckJobs.find((j) => j.state === "dead");
      expect(deadJob).toBeDefined();
    });
  });

  describe("3. Automation Observability (Test Matrix #10, #11)", () => {
    it("surfaces failed, cancelled, and skipped automation executions (Test Matrix #10, #11)", async () => {
      // Create rule
      const [rule] = await db
        .insert(s.automationRules)
        .values({
          studioId: studioAId,
          code: "RULE_TEST_OBS",
          name: "Test Rule",
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          config: {},
          createdById: ownerAId,
        })
        .returning();

      // Insert executions
      await db.insert(s.automationExecutions).values([
        {
          studioId: studioAId,
          ruleId: rule.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "CLIENT",
          entityId: randomUUID(),
          status: "succeeded",
          attemptCount: 1,
          scheduledFor: new Date(),
        },
        {
          studioId: studioAId,
          ruleId: rule.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "CLIENT",
          entityId: randomUUID(),
          status: "failed",
          attemptCount: 3,
          lastError: "Invalid phone number",
          scheduledFor: new Date(),
        },
        {
          studioId: studioAId,
          ruleId: rule.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "CLIENT",
          entityId: randomUUID(),
          status: "cancelled",
          attemptCount: 1,
          scheduledFor: new Date(),
        },
        {
          studioId: studioAId,
          ruleId: rule.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "CLIENT",
          entityId: randomUUID(),
          status: "skipped",
          attemptCount: 1,
          scheduledFor: new Date(),
        },
      ]);

      const metrics = await getAutomationMetrics(studioAId);
      expect(metrics.succeededCount).toBeGreaterThanOrEqual(1);
      expect(metrics.failedCount).toBeGreaterThanOrEqual(1);
      expect(metrics.cancelledCount).toBeGreaterThanOrEqual(1);
      expect(metrics.skippedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. Google Calendar Observability & Token Security (Test Matrix #12 - #14)", () => {
    it("surfaces needs_reauth and conflict mappings without exposing OAuth tokens (Test Matrix #12, #13, #14)", async () => {
      const connId = randomUUID();
      await db.insert(s.googleCalendarConnections).values({
        id: connId,
        studioId: studioAId,
        userId: ownerAId,
        calendarId: "cal-sec-test",
        status: "needs_reauth",
        syncStatus: "error",
        encryptedAccessToken: "sensitive_encrypted_access_token_should_never_leak",
        encryptedRefreshToken: "sensitive_encrypted_refresh_token_should_never_leak",
      });

      // Create client, master, service for foreign keys
      const [client] = await db
        .insert(s.clients)
        .values({
          studioId: studioAId,
          firstName: "Google",
          fullName: "Google Test Client",
          phone: "+79998887766",
          clientStatus: "new_lead",
        })
        .returning();

      const [master] = await db
        .insert(s.masters)
        .values({
          studioId: studioAId,
          displayName: "Master Google Test",
        })
        .returning();

      const [service] = await db
        .insert(s.services)
        .values({
          studioId: studioAId,
          name: "Test Service",
          category: "brows",
          procedureType: "brows",
          priceCents: 1000,
          durationMinutes: 30,
        })
        .returning();

      // Create an appointment for foreign key
      const [appt] = await db
        .insert(s.appointments)
        .values({
          studioId: studioAId,
          clientId: client.id,
          masterId: master.id,
          serviceId: service.id,
          startAt: new Date(Date.now() - 3600 * 1000),
          endAt: new Date(),
          source: "other",
          createdById: ownerAId,
          serviceSnapshot: {},
          clientSnapshot: {},
          masterSnapshot: {},
          priceSnapshotCents: 1000,
          durationSnapshotMinutes: 30,
        })
        .returning();

      await db.insert(s.googleCalendarEventMappings).values({
        studioId: studioAId,
        connectionId: connId,
        appointmentId: appt.id,
        googleEventId: "g-evt-conflict",
        status: "failed",
        lastSyncedHash: "hash-conflict-1",
        lastError: "Time slot conflict on external calendar",
      });

      const metrics = await getGoogleCalendarMetrics(studioAId);
      expect(metrics.needsReauthCount).toBeGreaterThanOrEqual(1);

      // Verify serialization of dashboard data never exposes tokens
      const dashboard = await getOperationsDashboardData(studioAId);
      const jsonString = JSON.stringify(dashboard);
      expect(jsonString).not.toContain("sensitive_encrypted_access_token");
      expect(jsonString).not.toContain("sensitive_encrypted_refresh_token");
    });
  });

  describe("5. AI Observability & Safety (Test Matrix #15 - #17)", () => {
    it("counts successful/failed runs and guardrail rejections without exposing raw prompts (Test Matrix #15, #16, #17)", async () => {
      await db.insert(s.aiRuns).values([
        {
          studioId: studioAId,
          userId: ownerAId,
          feature: "client_summary",
          entityType: "client",
          entityId: randomUUID(),
          status: "completed",
          provider: "mock",
          model: "mock-v1",
          promptVersion: "1.0",
          inputTokens: 100,
          outputTokens: 50,
          startedAt: new Date(Date.now() - 400),
          completedAt: new Date(),
        },
        {
          studioId: studioAId,
          userId: ownerAId,
          feature: "next_action",
          entityType: "client",
          entityId: randomUUID(),
          status: "failed",
          error: "PROHIBITED_MEDICAL_CLEARANCE_MUTATION",
          provider: "mock",
          model: "mock-v1",
          promptVersion: "1.0",
          startedAt: new Date(Date.now() - 250),
          completedAt: new Date(),
        },
      ]);

      const metrics = await getAiMetrics(studioAId);
      expect(metrics.successCount).toBeGreaterThanOrEqual(1);
      expect(metrics.guardrailRejectionCount).toBeGreaterThanOrEqual(1);
      expect(metrics.tokenUsage.totalTokens).toBeGreaterThanOrEqual(150);
    });
  });

  describe("6. Worker Heartbeat Detection (Test Matrix #18, #19)", () => {
    it("records and detects fresh worker heartbeats (Test Matrix #18)", async () => {
      await recordWorkerHeartbeat("outbox-worker", "inst-fresh", "1.0.0");
      const beats = await getWorkerHeartbeats();
      expect(beats.length).toBeGreaterThan(0);

      const found = beats.find((b) => b.instanceId === "inst-fresh");
      expect(found).toBeDefined();
      expect(found?.status).toBe("fresh");
    });

    it("detects stale worker state when heartbeat age exceeds threshold (Test Matrix #19)", async () => {
      // Backdate heartbeat to 10 minutes ago
      const staleInstanceId = `inst-stale-${randomUUID()}`;
      const tenMinAgo = new Date(Date.now() - 600 * 1000);
      await db.insert(s.workerHeartbeats).values({
        workerName: "outbox-worker",
        instanceId: staleInstanceId,
        version: "1.0.0",
        lastHeartbeat: tenMinAgo,
        startedAt: tenMinAgo,
      });

      const beats = await getWorkerHeartbeats(300, 1800);
      const stale = beats.find((b) => b.instanceId === staleInstanceId);
      expect(stale).toBeDefined();
      expect(stale?.status).toBe("stale");
    });
  });

  describe("7. Security, Tenant Isolation & RBAC (Test Matrix #20 - #22)", () => {
    it("rejects cross-studio operational metrics querying (Test Matrix #20)", async () => {
      session.id = ownerAId;
      session.studioId = studioAId;
      session.role = "OWNER";

      // Owner A attempting to query Studio B metrics
      await expect(getOperationsDashboardData(studioBId)).rejects.toThrow();
    });

    it("denies MASTER access to global operations dashboard (Test Matrix #21)", async () => {
      session.id = masterAId;
      session.studioId = studioAId;
      session.role = "MASTER";

      await expect(getOperationsDashboardData(studioAId)).rejects.toThrow("Permission denied");
    });

    it("allows OWNER and ADMIN access to operations dashboard (Test Matrix #22)", async () => {
      // 1. OWNER
      session.id = ownerAId;
      session.studioId = studioAId;
      session.role = "OWNER";

      const ownerData = await getOperationsDashboardData(studioAId);
      expect(ownerData.studioId).toBe(studioAId);

      // 2. ADMIN
      session.id = adminAId;
      session.studioId = studioAId;
      session.role = "ADMIN";

      const adminData = await getOperationsDashboardData(studioAId);
      expect(adminData.studioId).toBe(studioAId);
    });
  });

  describe("8. Side Effects & Retry Idempotency (Test Matrix #31, #32)", () => {
    it("ensures operational metrics reading produces zero business table writes (Test Matrix #31)", async () => {
      const countBefore = (await db.select({ count: sql`count(*)` }).from(s.clients))[0].count;

      await getOperationsDashboardData(studioAId);

      const countAfter = (await db.select({ count: sql`count(*)` }).from(s.clients))[0].count;
      expect(countAfter).toEqual(countBefore);
    });

    it("preserves idempotency during manual operator retries (Test Matrix #32)", async () => {
      session.id = ownerAId;
      session.studioId = studioAId;
      session.role = "OWNER";

      // Insert dead outbox job with known handler
      const [deadJob] = await db
        .insert(s.outboxJobs)
        .values({
          studioId: studioAId,
          eventKey: "evt-retry-idemp",
          handler: "client.created.v1",
          state: "dead",
          payload: { clientId: randomUUID() },
          payloadHash: "hash-retry-idemp",
          attempts: 8,
          maxAttempts: 8,
          lastError: "attempts_exhausted",
        })
        .returning();

      // First retry succeeds
      const res1 = await retryOutboxJob({
        id: deadJob.id,
        reason: "Operator manual recovery test 1",
      });
      expect(res1.success).toBe(true);

      // Job is now pending
      const [updated] = await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.id, deadJob.id));
      expect(updated.state).toBe("pending");
      expect(updated.attempts).toBe(0);

      // Second retry on already-pending job is rejected safely (idempotent / non-destructive)
      await expect(
        retryOutboxJob({
          id: deadJob.id,
          reason: "Operator manual recovery test 2",
        })
      ).rejects.toThrow();

      // Test automation execution retry
      const [rule] = await db
        .insert(s.automationRules)
        .values({
          studioId: studioAId,
          code: `test_rule_retry_${randomUUID()}`,
          name: "Test Rule Retry",
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          config: {},
        })
        .returning();

      const [failedExec] = await db
        .insert(s.automationExecutions)
        .values({
          studioId: studioAId,
          ruleId: rule.id,
          triggerType: "APPOINTMENT_CREATED",
          actionType: "CREATE_OPERATIONAL_REMINDER",
          entityType: "appointment",
          entityId: randomUUID(),
          status: "failed",
          lastError: "transient network error",
        })
        .returning();

      if (failedExec) {
        const autoRes = await retryAutomationExecution({
          id: failedExec.id,
          reason: "Manual retry of failed automation execution",
        });
        expect(autoRes.success).toBe(true);
      }

      // Test Google calendar connection reconcile
      const [reauthConn] = await db
        .insert(s.googleCalendarConnections)
        .values({
          studioId: studioAId,
          userId: ownerAId,
          googleEmail: "reauth-test@example.com",
          status: "needs_reauth",
          syncStatus: "error",
          lastError: "invalid_grant",
        })
        .returning();

      if (reauthConn) {
        const calRes = await reconcileGoogleCalendarConnection({
          id: reauthConn.id,
          reason: "Manual reconcile of google calendar connection",
        });
        expect(calRes.success).toBe(true);
      }
    });
  });
});
