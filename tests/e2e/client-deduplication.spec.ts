import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("Owner reviews a formatted contact match before creating a separate family member on mobile", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `dedup-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, { data: { name: "Synthetic Owner", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(row => row.id);
    const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });
    const [original] = await db.insert(s.clients).values({ ...clientFixture(studioId), firstName: "Anna", lastName: "Rossi", fullName: "Anna Rossi", phone: "+39 (333) 123-4567" }).returning();
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/clients/new");
    await page.getByLabel("Имя", { exact: true }).fill("Maria");
    await page.getByLabel("Фамилия", { exact: true }).fill("Rossi");
    await page.getByLabel("Телефон", { exact: true }).fill("0039 3331234567");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    const panel = page.getByRole("region", { name: "Проверка совпадений" });
    await expect(panel).toBeVisible(); await expect(panel.getByText("Anna Rossi", { exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Открыть карточку" })).toHaveAttribute("href", `/clients/${original.id}`);
    expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
    const confirm = panel.getByRole("button", { name: "Подтверждаю: создать отдельную карточку" });
    await expect(confirm).toBeDisabled();
    await panel.getByLabel("Почему это отдельный клиент").fill("Shared family phone; a different person");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await confirm.click(); await expect(page).toHaveURL(/\/clients\/[a-f0-9-]+$/);
    const rows = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    expect(rows).toHaveLength(2); const created = rows.find(row => row.id !== original.id)!;
    expect(created).toMatchObject({ fullName: "Maria Rossi", phone: "+393331234567", phoneKey: original.phoneKey });
    const decisions = await db.select().from(s.clientDuplicateDecisions).where(eq(s.clientDuplicateDecisions.studioId, studioId));
    expect(decisions).toHaveLength(1); expect(decisions[0]).toMatchObject({ clientId: created.id, actorId: owner.id, reason: "Shared family phone; a different person" });
    const audits = await db.select().from(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
    expect(audits.filter(row => row.action === "client_duplicate_accepted")).toHaveLength(1);
  } finally {
    try { if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
