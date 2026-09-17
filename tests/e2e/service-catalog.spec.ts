import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("Owner imports catalog, configures missing duration and preserves edits on repeat import", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `catalog-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, { data: { name: "Catalog Owner", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(row => row.id);
    const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/services");
    await page.getByRole("button", { name: "Добавить каталог из ТЗ" }).click();
    await expect(page.getByText("Добавлено: 13", { exact: true })).toBeVisible();
    const rows = await db.select().from(s.services).where(eq(s.services.studioId, studioId));
    expect(rows).toHaveLength(13);
    const skin = rows.find(row => row.catalogCode === "skin-korean")!;
    expect(skin.isActive).toBe(false); expect(skin.durationMinutes).toBeNull();
    await page.goto(`/services/${skin.id}/edit`);
    await expect(page.getByLabel("Услуга из справочника")).toBeDisabled();
    await page.getByLabel("Длительность (минуты)").fill("60");
    await page.getByLabel("Базовая цена / нижняя граница (€)").fill("125.50");
    await page.getByLabel("Причина изменения цены").fill("Synthetic owner price review");
    await page.getByLabel("Активна", { exact: true }).check();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
    await page.getByRole("button", { name: "Добавить каталог из ТЗ" }).click();
    await expect(page.getByText("Добавлено: 0", { exact: true })).toBeVisible();
    const [saved] = await db.select().from(s.services).where(eq(s.services.id, skin.id));
    expect(saved.priceCents).toBe(12550); expect(saved.durationMinutes).toBe(60); expect(saved.isActive).toBe(true);
    await page.goto(`/services/${rows.find(row => row.catalogCode === "eyes-eyeliner")!.id}/edit`);
    await expect(page.getByLabel("Как определяется цена")).toHaveValue("range");
    await expect(page.getByLabel("Верхняя граница (€)")).toHaveValue("500");
    await expect(page.getByLabel("Длительность (минуты)")).toHaveAttribute("readonly", "");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    try { if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
