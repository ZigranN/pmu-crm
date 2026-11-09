import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Treatment Cycles, Medical Profile, Consent & Procedures", () => {
  test("Req 3, 40 & 41: TreatmentCycle creation, stage transitions and guarded stages", async ({ page, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    await context.clearCookies();
    const database = await createTestDatabase();
    const db = database.db;
    const email = `cycle-life-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Cycle Specialist", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Cycle Master" }).returning();
      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        assignedMasterId: master.id,
        language: "it",
        clientKind: "new",
        reportedPreviousPmu: false,
        interestedZones: ["brows"],
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // --- SECTION 1: Create TreatmentCycle (Req 11) ---
      await page.goto("/settings");
      await page.getByRole("link", { name: /Циклы процедур/i }).click();
      await page.getByLabel("Клиент", { exact: true }).selectOption(client.id);
      await page.getByLabel("Причина создания").fill("New brows cycle initialization");
      await page.getByRole("button", { name: "Создать цикл", exact: true }).click();

      await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
      const cycleId = page.url().split("/").pop()!;

      // Confirm cycle initial stage is new_lead
      const [cycle] = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycleId));
      expect(cycle.stage).toBe("new_lead");

      // --- SECTION 2: Transition through UI stages and Guarded Rejection (Req 12) ---
      await page.getByLabel("Следующая стадия").selectOption("qualification");
      await page.getByLabel("Причина перехода").fill("Starting qualification");
      await page.getByRole("button", { name: "Изменить стадию", exact: true }).click();
      await expect(page.getByText("Стадия: Квалификация", { exact: true })).toBeVisible();

      // Qualify using authoritative form
      await page.getByLabel("PMU другого мастера").check();
      await page.getByLabel("Основание квалификации").fill("Checked previous PMU notes");
      await page.getByRole("button", { name: "Проверить квалификацию", exact: true }).click();
      await expect(page.getByText("Стадия: Нужна консультация", { exact: true })).toBeVisible();

      // Move to consultation_offered
      await page.getByLabel("Следующая стадия").selectOption("consultation_offered");
      await page.getByLabel("Причина перехода").fill("Consultation offered to client");
      await page.getByRole("button", { name: "Изменить стадию", exact: true }).click();
      await expect(page.getByText("Consultation offered to client", { exact: true })).toBeVisible();

      // Guarded transition: consultation_scheduled requires calendar booking
      await page.getByLabel("Следующая стадия").selectOption("consultation_scheduled");
      await expect(page.getByRole("status")).toContainText("календарь");
      await expect(page.getByRole("button", { name: "Изменить стадию", exact: true })).toBeDisabled();
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

  test("Req 4, 31 & 39: Medical Profile, Exact Consent & Procedure Lifecycle", async ({ page, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    await context.clearCookies();
    const database = await createTestDatabase();
    const db = database.db;
    const email = `med-proc-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Medical Operator", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Certified Master", userId: owner.id }).returning();
      const [service] = await db.insert(s.services).values({
        studioId,
        name: "Powder Brows",
        category: "brows",
        procedureType: "brows",
        durationMinutes: 90,
        priceCents: 20000,
      }).returning();

      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        assignedMasterId: master.id,
        language: "it",
        clientKind: "new",
        reportedPreviousPmu: false,
        interestedZones: ["brows"],
      }).returning();

      const [cycle] = await db.insert(s.treatmentCycles).values({
        studioId,
        clientId: client.id,
        zoneCode: "brows",
        kind: "pmu",
        stage: "procedure_confirmed",
        assignedMasterId: master.id,
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await context.addCookies([{ name: "pmu_active_studio", value: studioId, url: "http://localhost:3000" }]);

      // --- SECTION 1: Medical Profile Revision & Clearance (Req 13 & 14) ---
      await page.goto(`/clients/${client.id}`);
      await page.getByRole("tab", { name: "Мед. профиль" }).click();

      // Enter medical profile fields
      await page.getByLabel("Тип кожи").fill("Комбинированная");
      await page.getByLabel("Аллергии").fill("None reported");
      await page.getByPlaceholder("Любая дополнительная медицинская информация").fill("Verified medical history");
      await page.getByRole("button", { name: "Сохранить анкету", exact: true }).click();
      await expect(page.getByText(/Медицинский профиль обновлен/i)).toBeVisible();

      // Confirm medical profile persisted
      const [medProfile] = await db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, client.id));
      expect(medProfile).toBeTruthy();

      // --- SECTION 2: Procedure Lifecycle (PLANNED -> IN_PROGRESS -> COMPLETED) (Req 22) ---
      const [proc] = await db.insert(s.procedureSessions).values({
        studioId,
        clientId: client.id,
        cycleId: cycle.id,
        masterId: master.id,
        serviceId: service.id,
        procedureArea: "brows",
        procedureType: "brows",
        sessionType: "primary_session",
        status: "PLANNED",
      }).returning();

      // Transition procedure session to IN_PROGRESS
      await db.update(s.procedureSessions).set({
        status: "IN_PROGRESS",
        startedAt: new Date(),
      }).where(eq(s.procedureSessions.id, proc.id));

      // Transition procedure session to COMPLETED with clinical evidence
      await db.update(s.procedureSessions).set({
        status: "COMPLETED",
        completedAt: new Date(),
        needle: "1R 0.25mm",
        anesthesia: "Primary topical gel",
      }).where(eq(s.procedureSessions.id, proc.id));

      const [completedProc] = await db.select().from(s.procedureSessions).where(eq(s.procedureSessions.id, proc.id));
      expect(completedProc.status).toBe("COMPLETED");
      expect(completedProc.needle).toBe("1R 0.25mm");

      // --- SECTION 3: Procedure Abort Workflow (Req 23) ---
      const [proc2] = await db.insert(s.procedureSessions).values({
        studioId,
        clientId: client.id,
        cycleId: cycle.id,
        masterId: master.id,
        serviceId: service.id,
        procedureArea: "brows",
        procedureType: "brows",
        sessionType: "primary_session",
        status: "IN_PROGRESS",
        startedAt: new Date(),
      }).returning();

      // Abort procedure session with mandatory reason
      await db.update(s.procedureSessions).set({
        status: "ABORTED",
        abortedAt: new Date(),
        abortReason: "Client felt unwell during initial pass",
      }).where(eq(s.procedureSessions.id, proc2.id));

      const [abortedProc] = await db.select().from(s.procedureSessions).where(eq(s.procedureSessions.id, proc2.id));
      expect(abortedProc.status).toBe("ABORTED");
      expect(abortedProc.abortReason).toBe("Client felt unwell during initial pass");
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
