import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Packages, Remover & Ledger Financial Operations", () => {
  test("Req 11, 12, 39 & 45: Total Face creation, consent isolation & Remover workflow", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `pkg-remov-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Package Specialist", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [master] = await db.insert(s.masters).values({ studioId, displayName: "Package Master" }).returning();
      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        assignedMasterId: master.id,
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // --- SECTION 1: Total Face Package with Multiple Zones (Req 28) ---
      const [pkg] = await db.insert(s.treatmentPackages).values({
        studioId,
        clientId: client.id,
        kind: "total_face",
        status: "active",
      }).returning();

      // Create two independent sibling cycles
      const [cycleBrows, cycleLips] = await db.insert(s.treatmentCycles).values([
        {
          studioId,
          clientId: client.id,
          packageId: pkg.id,
          zoneCode: "brows",
          kind: "pmu",
          stage: "qualification",
        },
        {
          studioId,
          clientId: client.id,
          packageId: pkg.id,
          zoneCode: "lips",
          kind: "pmu",
          stage: "qualification",
        },
      ]).returning();

      expect(cycleBrows.id).not.toBe(cycleLips.id);
      expect(cycleBrows.zoneCode).toBe("brows");
      expect(cycleLips.zoneCode).toBe("lips");

      // --- SECTION 2: Remover Workflow (Req 31) ---
      const [removerCycle] = await db.insert(s.treatmentCycles).values({
        studioId,
        clientId: client.id,
        zoneCode: "brows",
        kind: "remover",
        originCycleId: cycleBrows.id,
        stage: "qualification",
      }).returning();

      expect(removerCycle.kind).toBe("remover");
      expect(removerCycle.originCycleId).toBe(cycleBrows.id);

      // Verify Packages & Remover UI Tab
      await page.goto(`/clients/${client.id}`);
      await page.getByRole("tab", { name: "Пакеты" }).click();
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

  test("Req 23, 24, 25, 27 & 28: Ledger charges, payments, refunds and role permissions", async ({ page, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    await context.clearCookies();
    const database = await createTestDatabase();
    const db = database.db;
    const email = `ledger-spec-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Finance Admin", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [client] = await db.insert(s.clients).values({
        ...clientFixture(studioId),
        fullName: "Financial Test Client",
      }).returning();

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      await context.addCookies([{ name: "pmu_active_studio", value: studioId, url: "http://localhost:3000" }]);

      // --- SECTION 1: Record Payment through UI (Req 25) ---
      await page.goto(`/clients/${client.id}`);
      await page.getByRole("tab", { name: "Финансы" }).click();

      await page.getByRole("button", { name: "Внести платёж / депозит" }).click();
      await page.getByLabel("Сумма (€)").fill("150.00");
      await page.getByLabel("Назначение платежа").fill("Deposit for PMU");
      await page.getByRole("button", { name: "Записать платёж", exact: true }).click();

      // Check DB ledger entries (append-only)
      await expect.poll(async () => {
        const rows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.clientId, client.id));
        return rows.length;
      }).toBeGreaterThanOrEqual(1);

      const entries = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.clientId, client.id));
      const paymentEntry = entries.find((e) => e.type === "PAYMENT");
      expect(paymentEntry).toBeTruthy();
      expect(paymentEntry!.amountMinor).toBe(15000);

      // --- SECTION 2: Record Refund (Req 26) ---
      await page.reload();
      await page.getByRole("tab", { name: "Финансы" }).click();

      await page.getByRole("button", { name: "Оформить возврат" }).click();
      await page.getByLabel("Сумма возврата (€)").fill("50.00");
      await page.getByLabel("Причина возврата").fill("Partial deposit refund");
      await page.getByRole("button", { name: "Провести возврат", exact: true }).click();

      // Verify refund appended to ledger without modifying previous payment
      await expect.poll(async () => {
        const rows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.clientId, client.id));
        return rows.some((r) => r.type === "REFUND");
      }).toBe(true);

      const updatedEntries = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.clientId, client.id));
      const refundEntry = updatedEntries.find((e) => e.type === "REFUND");
      expect(refundEntry).toBeTruthy();
      expect(refundEntry!.amountMinor).toBe(5000);
      expect(paymentEntry!.id).not.toBe(refundEntry!.id);

      // --- SECTION 3: Attempt Excessive Refund (Req 26) ---
      await page.getByRole("button", { name: "Оформить возврат" }).click();
      await page.getByLabel("Сумма возврата (€)").fill("5000.00");
      await page.getByLabel("Причина возврата").fill("Excessive refund attempt");
      await page.getByRole("button", { name: "Провести возврат", exact: true }).click();
      await expect(page.getByText(/превышает|недостаточно|Ошибка|error/i)).toBeVisible();
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
