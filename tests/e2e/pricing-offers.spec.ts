import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("Owner sets master price and approves multi-zone offer; Admin creates a new revision without changing history", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `offers-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, { data: { name: "Synthetic Approver", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(row => row.id);
    const roles = await db.select().from(s.roles);
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: roles.find(row => row.code === "OWNER")!.id });
    const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/services"); await page.getByRole("button", { name: "Добавить каталог из ТЗ" }).click();
    await expect(page.getByText("Добавлено: 13", { exact: true })).toBeVisible();
    const services = await db.select().from(s.services).where(eq(s.services.studioId, studioId));
    const brows = services.find(row => row.catalogCode === "brows-hair")!, eyes = services.find(row => row.catalogCode === "eyes-lashline")!;
    const [master] = await db.insert(s.masters).values({ studioId, displayName: "Test Master" }).returning();
    await db.insert(s.masterServices).values({ studioId, masterId: master.id, serviceId: brows.id });
    await page.goto(`/services/${brows.id}/edit`); await page.getByRole("link", { name: "Цены мастеров" }).click();
    await page.getByLabel("Цена мастера (€)", { exact: true }).fill("650");
    await page.getByLabel("Причина изменения", { exact: true }).fill("Synthetic master price approval");
    await page.getByRole("button", { name: "Сохранить цену мастера" }).click();
    await expect.poll(async () => (await db.select().from(s.masterPriceRevisions).where(eq(s.masterPriceRevisions.studioId, studioId!))).length).toBe(1);
    await page.goto(`/clients/${client.id}`); await page.getByRole("link", { name: "Custom Offer" }).click();
    await page.getByLabel("Услуга и мастер — зона 1").selectOption(`${brows.id}:${master.id}`);
    await page.getByLabel("Услуга и мастер — зона 2").selectOption(`${eyes.id}:base`);
    await page.getByLabel("Согласованная итоговая цена (€)").fill("900");
    await page.getByLabel("Причина предложения / изменения цены").fill("Synthetic multi-zone agreement");
    await expect(page.getByLabel("Расчёт предложения")).toContainText("1.000,00");
    await page.getByRole("button", { name: "Сохранить предложение", exact: true }).click();
    await expect(page.getByText("Предложение сохранено", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Изменить предложение" })).toBeVisible();
    const [first] = await db.select().from(s.offerRevisions).where(eq(s.offerRevisions.studioId, studioId));
    expect(first).toMatchObject({ standardTotalCents: 100000, agreedTotalCents: 90000, discountCents: 10000, approvedById: owner.id });
    await db.update(s.studioMembers).set({ roleId: roles.find(row => row.code === "ADMIN")!.id }).where(and(eq(s.studioMembers.studioId, studioId), eq(s.studioMembers.userId, owner.id)));
    await page.reload(); await page.getByRole("button", { name: "Изменить предложение" }).click();
    await page.getByLabel("Согласованная итоговая цена (€)").fill("850");
    await page.getByLabel("Причина предложения / изменения цены").fill("Synthetic revised agreement");
    await page.getByRole("button", { name: "Сохранить предложение", exact: true }).click();
    await expect(page.getByText("Synthetic revised agreement", { exact: false })).toBeVisible();
    expect((await db.select().from(s.offerRevisions).where(eq(s.offerRevisions.id, first.id)))[0]).toEqual(first);
    expect(await db.select().from(s.offerRevisions).where(eq(s.offerRevisions.studioId, studioId))).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    try { if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
