import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("Owner records administrative qualification, chooses preferred master and edits without touching clinical data", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `admin-card-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, { data: { name: "Synthetic Owner", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(row => row.id);
    const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });
    const [master] = await db.insert(s.masters).values({ studioId, displayName: "Preferred Test Master" }).returning();
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/clients/new");
    await page.getByLabel("Имя", { exact: true }).fill("Administrative Test");
    await page.getByLabel("Телефон", { exact: true }).fill("+390000000000");
    await page.getByLabel("Язык общения", { exact: true }).selectOption("it");
    await page.getByLabel("Тип клиента", { exact: true }).selectOption("returning");
    await page.getByLabel("Предыдущий PMU со слов клиента", { exact: true }).selectOption("yes");
    await page.getByLabel("Брови", { exact: true }).check(); await page.getByLabel("Губы", { exact: true }).check();
    await page.getByLabel("Источник", { exact: true }).click(); await page.getByRole("option", { name: "Рекомендация", exact: true }).click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page).toHaveURL(/\/clients\/[a-f0-9-]+$/);
    const [client] = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    expect(client).toMatchObject({ language: "it", clientKind: "returning", reportedPreviousPmu: true, interestedZones: ["brows", "lips"], source: "referral", clientStatus: "new_lead" });
    await expect(page.getByText("Язык: Italiano", { exact: true })).toBeVisible();
    await page.getByLabel("Предпочтительный мастер", { exact: true }).selectOption(master.id);
    await page.getByLabel("Причина выбора предпочтительного мастера", { exact: true }).fill("Client requested this master");
    await page.getByRole("button", { name: "Сохранить предпочтение", exact: true }).click();
    await expect(page.getByText("Предпочтительный мастер: Preferred Test Master", { exact: true })).toBeVisible();
    const [medical] = await db.insert(s.clientMedicalProfiles).values({ clientId: client.id, previousPMU: true, medicalNotes: "Clinical record must stay unchanged" }).returning();
    await page.goto(`/clients/${client.id}/edit`);
    await expect(page.getByLabel("Язык общения", { exact: true })).toHaveValue("it");
    await expect(page.getByLabel("Брови", { exact: true })).toBeChecked();
    await page.getByLabel("Язык общения", { exact: true }).selectOption("en");
    await page.getByLabel("Предыдущий PMU со слов клиента", { exact: true }).selectOption("no");
    await page.getByLabel("Губы", { exact: true }).uncheck();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/clients/${client.id}$`));
    expect((await db.select().from(s.clients).where(eq(s.clients.id, client.id)))[0]).toMatchObject({ language: "en", interestedZones: ["brows"], reportedPreviousPmu: false, preferredMasterId: master.id, assignedMasterId: null });
    expect((await db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, client.id)))[0]).toEqual(medical);
  } finally {
    try { if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
