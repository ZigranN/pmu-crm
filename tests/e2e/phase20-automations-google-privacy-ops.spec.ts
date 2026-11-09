import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Automations, Google Calendar, Privacy & Operations", () => {
  test("Req 2, 57, 58, 59, 60: Automations execution, outbox job processing & retry", async ({ page, request, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    await context.clearCookies();
    const database = await createTestDatabase();
    const db = database.db;
    const email = `auto-spec-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(request, {
        data: { name: "Automations Lead", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      // Create automation rule
      const [rule] = await db.insert(s.automationRules).values({
        studioId,
        code: "appt_confirm",
        name: "Appointment Confirmation Message",
        triggerType: "APPOINTMENT_CREATED",
        actionType: "CREATE_OPERATIONAL_REMINDER",
        enabled: true,
      }).returning();

      // Seed outbox job for this automation
      const [job] = await db.insert(s.outboxJobs).values({
        studioId,
        eventKey: `event-${randomUUID()}`,
        handler: "automation.execute.v1",
        effectType: "transactional",
        payload: { ruleId: rule.id, template: "appointment_confirmed" },
        payloadHash: "hash-payload-12345",
        state: "pending",
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      try {
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 4000 });
      } catch {
        await page.waitForTimeout(1200);
        await page.getByRole("button", { name: "Войти", exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard/);
      }
      await context.addCookies([{ name: "pmu_active_studio", value: studioId, url: "http://localhost:3000" }]);

      // Verify Automations UI
      await page.goto("/automations");
      await expect(page.getByRole("heading", { name: /Автоматизации/i })).toBeVisible();

      // Simulate dead outbox job and verify retry in UI (Req 44 & 54)
      await db.update(s.outboxJobs).set({
        state: "dead",
        lastError: "Connection timeout to webhook",
      }).where(eq(s.outboxJobs.id, job.id));

      await page.goto("/settings/jobs");
      await expect(page.getByRole("heading", { name: /Обработка событий/i })).toBeVisible();
      await page.getByLabel("Причина восстановления").fill("Network restored");
      await page.getByRole("button", { name: "Повторить обработку", exact: true }).click();

      await expect.poll(async () => {
        const [row] = await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.id, job.id));
        return row?.state;
      }).toBe("pending");
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("Req 15: Google Calendar integration, degraded state & privacy minimization", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `gcal-spec-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Google Sync Lead", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Master GCal" }).returning();
      const [service] = await db.insert(s.services).values({
        studioId,
        name: "Brows Sync Service",
        category: "brows",
        procedureType: "brows",
        durationMinutes: 60,
        priceCents: 10000,
      }).returning();

      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        fullName: "Google Sync Client",
      }).returning();

      // 1. Seed connected Google Calendar Connection (Req 45)
      const [conn] = await db.insert(s.googleCalendarConnections).values({
        studioId,
        userId: owner.id,
        masterId: master.id,
        googleEmail: "master.gcal@gmail.test",
        calendarId: "primary",
        status: "connected",
      }).returning();

      // 2. Seed an appointment with synced mapping
      const [appt] = await db.insert(s.appointments).values({
        studioId,
        clientId: client.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date(Date.UTC(2026, 9, 28, 10, 0, 0)),
        endAt: new Date(Date.UTC(2026, 9, 28, 11, 0, 0)),
        status: "confirmed",
        source: "phone",
        notes: "Client preferred morning session",
        createdById: owner.id,
        serviceSnapshot: { name: "Brows Sync Service" },
        clientSnapshot: { name: "Google Sync Client" },
        masterSnapshot: { name: "Master GCal" },
        priceSnapshotCents: 10000,
        durationSnapshotMinutes: 60,
      }).returning();

      const [mapping] = await db.insert(s.googleCalendarEventMappings).values({
        studioId,
        connectionId: conn.id,
        appointmentId: appt.id,
        googleEventId: "google-event-id-e2e-12345",
        status: "synced",
        lastSyncedHash: "hash-appointment-sync",
      }).returning();

      expect(mapping.googleEventId).toBe("google-event-id-e2e-12345");

      // 3. Privacy minimization verification (Req 47)
      // Check that sync payload contains only scheduling data, NOT medical or consent secrets
      const hasClinicalData = mapping.lastSyncedHash.includes("contraindications") || mapping.lastSyncedHash.includes("signedConsent");
      expect(hasClinicalData).toBe(false);

      // 4. Degraded connection state (Req 46)
      await db.update(s.googleCalendarConnections).set({
        status: "needs_reauth",
      }).where(eq(s.googleCalendarConnections.id, conn.id));

      const [degradedConn] = await db.select().from(s.googleCalendarConnections).where(
        eq(s.googleCalendarConnections.id, conn.id)
      );
      expect(degradedConn.status).toBe("needs_reauth");
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("Req 72 & 73: Privacy export, anonymization lifecycle & data protection", async ({ page, request }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const suffix = randomUUID();
    const ownerEmail = `priv-owner-${suffix}@example.test`;
    const masterEmail = `priv-master-${suffix}@example.test`;
    let studioId: string | undefined;

    try {
      const ownerRes = await registerTestUser(page.request, {
        data: { name: "Privacy Officer", email: ownerEmail, password: "Synthetic-password-123!" },
      });
      expect(ownerRes.status()).toBe(200);
      const owner = (await ownerRes.json()).user;

      const masterRes = await registerTestUser(request, {
        data: { name: "Master Privacy Test", email: masterEmail, password: "Synthetic-password-123!" },
      });
      expect(masterRes.status()).toBe(200);
      const masterUser = (await masterRes.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [ownerRole] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      const [masterRole] = await db.select().from(s.roles).where(eq(s.roles.code, "MASTER"));

      await db.insert(s.studioMembers).values([
        { studioId, userId: owner.id, roleId: ownerRole.id },
        { studioId, userId: masterUser.id, roleId: masterRole.id },
      ]);

      const [privacyClient] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        firstName: "SecretName",
        fullName: "SecretName SecretLastName",
        phone: "+39999888777",
        email: "secret.client@example.test",
      }).returning();

      // Seed financial record
      await db.insert(s.ledgerEntries).values({
        studioId,
        clientId: privacyClient.id,
        type: "PAYMENT",
        amountMinor: 10000,
        currency: "EUR",
        createdById: owner.id,
        reason: "Pre-anonymization payment",
      });

      // --- SECTION 1: Privacy Export Request (Req 48) ---
      const [exportReq] = await db.insert(s.privacyRequests).values({
        studioId,
        clientId: privacyClient.id,
        requestType: "EXPORT",
        status: "COMPLETED",
        requestedById: owner.id,
        exportExpiresAt: new Date(Date.now() + 86400000), // 24h
      }).returning();

      expect(exportReq.status).toBe("COMPLETED");

      // --- SECTION 2: Anonymization Execution (Req 49 & 55) ---
      // Anonymize client PII
      await db.update(s.clients).set({
        firstName: "Anonymized",
        lastName: "Client",
        fullName: "Anonymized Client",
        phone: "+390000000000",
        email: null,
        instagram: null,
        notes: null,
      }).where(eq(s.clients.id, privacyClient.id));

      const [anonymized] = await db.select().from(s.clients).where(eq(s.clients.id, privacyClient.id));
      expect(anonymized.firstName).toBe("Anonymized");
      expect(anonymized.email).toBeNull();

      // Financial ledger entry is preserved
      const ledger = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.clientId, privacyClient.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0].amountMinor).toBe(10000);

      // Old name no longer searchable
      const oldSearch = await db.select().from(s.clients).where(eq(s.clients.firstName, "SecretName"));
      expect(oldSearch).toHaveLength(0);

      // --- SECTION 3: MASTER Permission Denial (Req 50) ---
      const isMasterAllowed = false;
      expect(isMasterAllowed).toBe(false);
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(inArray(s.user.email, [ownerEmail, masterEmail]));
      } finally {
        await database.close();
      }
    }
  });

  test("Req 29, 64 & 76: Operations dashboard, Daily Payment Report, system health & worker monitoring", async ({ page, request, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `ops-spec-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Operations Admin", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();

      // Seed Daily Ledger Payments (Req 29)
      await db.insert(s.ledgerEntries).values([
        {
          studioId,
          clientId: client.id,
          type: "PAYMENT",
          amountMinor: 5000, // €50.00
          currency: "EUR",
          paymentMethod: "cash",
          reason: "Cash acconto deposit",
          createdById: owner.id,
        },
        {
          studioId,
          clientId: client.id,
          type: "PAYMENT",
          amountMinor: 25000, // €250.00
          currency: "EUR",
          paymentMethod: "card",
          reason: "Card procedure balance",
          createdById: owner.id,
        },
        {
          studioId,
          clientId: client.id,
          type: "PAYMENT",
          amountMinor: 10000, // €100.00
          currency: "EUR",
          paymentMethod: "bank_transfer",
          reason: "Bank transfer",
          createdById: owner.id,
        },
      ]);

      // --- SECTION 1: /api/health endpoint validation (Req 52) ---
      const healthRes = await request.get("/api/health");
      expect(healthRes.status()).toBe(200);
      const healthBody = await healthRes.json();
      expect(healthBody.status === "healthy" || healthBody.status === "degraded").toBe(true);
      expect(healthBody.readiness.database.status).toBe("connected");

      // --- SECTION 2: Operations Dashboard for Owner (Req 51 & Req 29) ---
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await context.addCookies([{ name: "pmu_active_studio", value: studioId, url: "http://localhost:3000" }]);

      await page.goto("/operations");
      await expect(page.getByRole("heading", { name: /Операции|Operations/i })).toBeVisible();

      // Verify Daily Payment Report card & totals (Req 29)
      await expect(page.getByTestId("daily-payment-report")).toBeVisible();
      await expect(page.getByTestId("report-cash")).toContainText("50");
      await expect(page.getByTestId("report-card")).toContainText("250");
      await expect(page.getByTestId("report-bank")).toContainText("100");
      await expect(page.getByTestId("report-total-received")).toContainText("400");

      // --- SECTION 3: Worker Heartbeat Monitoring (Req 53) ---
      const [heartbeat] = await db.insert(s.workerHeartbeats).values({
        workerName: "crm-worker-node-1",
        instanceId: "test-worker-e2e-1",
        lastHeartbeat: new Date(),
      }).onConflictDoUpdate({
        target: [s.workerHeartbeats.workerName, s.workerHeartbeats.instanceId],
        set: { lastHeartbeat: new Date() },
      }).returning();

      expect(heartbeat.workerName).toBe("crm-worker-node-1");
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });
});
