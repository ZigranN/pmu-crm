import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("Owner links a Master and assigns a client; mobile Master cannot open another client", async ({ page, request }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(); const db = database.db;
  const suffix = randomUUID(); const ownerEmail = `owner-${suffix}@example.test`, masterEmail = `master-${suffix}@example.test`;
  let studioId: string | undefined;
  try {
    const ownerResponse = await page.request.post("/api/auth/sign-up/email", { data: { email: ownerEmail, name: "Synthetic Owner", password: "Synthetic-password-123!" } });
    expect(ownerResponse.status()).toBe(200); const owner = (await ownerResponse.json()).user;
    const masterResponse = await request.post("/api/auth/sign-up/email", { data: { email: masterEmail, name: "Synthetic Master", password: "Synthetic-password-123!" } });
    expect(masterResponse.status()).toBe(200);
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(r => r.id);
    const [ownerRole] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: ownerRole.id });
    const [master, otherMaster] = await db.insert(s.masters).values([{ studioId, displayName: "Assigned profile" }, { studioId, displayName: "Other profile" }]).returning();
    const [client, other] = await db.insert(s.clients).values([{ ...clientFixture(studioId), fullName: "Assigned client", firstName: "Assigned" },
      { ...clientFixture(studioId), fullName: "Private other client", firstName: "Private", assignedMasterId: otherMaster.id }]).returning();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/team");
    await page.getByLabel("Email зарегистрированного пользователя").fill(masterEmail);
    await page.getByLabel("Профиль мастера").selectOption(master.id);
    await page.getByLabel("Причина изменения").fill("Master account setup");
    await page.getByRole("button", { name: "Сохранить участника" }).click();
    await expect(page.locator("li").filter({ hasText: masterEmail })).toBeVisible();
    await page.goto(`/clients/${client.id}`);
    await page.getByLabel("Назначенный мастер").selectOption(master.id);
    await page.getByLabel("Причина назначения").fill("Client chose master");
    await page.getByRole("button", { name: "Сохранить назначение" }).click();
    await expect(page.getByLabel("Причина назначения")).toHaveValue("");
    expect((await db.select().from(s.clients).where(eq(s.clients.id, client.id)))[0].assignedMasterId).toBe(master.id);
    await page.goto("/settings/audit");
    await expect(page.getByRole("heading", { name: "История изменений и доступа" })).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: "client_master_assigned" })).toBeVisible();
    await page.getByRole("link", { name: "Доступ к данным", exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: "audit.list" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email", { exact: true }).fill(masterEmail);
    await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/clients");
    await expect(page.getByText("Assigned client", { exact: true })).toBeVisible();
    await expect(page.getByText("Private other client", { exact: true })).toHaveCount(0);
    await page.goto(`/clients/${other.id}`);
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page.getByText("Private other client", { exact: true })).toHaveCount(0);
    await page.goto("/settings/team");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/settings/audit");
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    try {
      if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(inArray(s.user.email, [ownerEmail, masterEmail]));
    } finally { await database.close(); }
  }
});
