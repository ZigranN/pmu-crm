import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("commercial terms: mobile lost-response retry preserves one revision, extension preserves original", async ({page}) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  const database = await createTestDatabase(), db = database.db, email = `terms-${randomUUID()}@example.test`;
  let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, {data: {name: "Terms Owner", email, password: "Synthetic-password-123!"}});
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(r => r.id);
    const roles = await db.select().from(s.roles);
    await db.insert(s.studioMembers).values({studioId, userId: owner.id, roleId: roles.find(r => r.code === "OWNER")!.id});
    const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();
    await page.setViewportSize({width: 390, height: 844});
    await page.goto("/services"); await page.getByRole("button", {name: "Добавить каталог из ТЗ"}).click();
    await expect(page.getByText("Добавлено: 13", {exact: true})).toBeVisible();
    const services = await db.select().from(s.services).where(eq(s.services.studioId, studioId));
    const brows = services.find(r => r.catalogCode === "brows-hair")!;
    const [cycle] = await db.insert(s.treatmentCycles).values({studioId, clientId: client.id, kind: "pmu", zoneCode: "brows", stage: "thinking"}).returning();
    await page.goto(`/deals/${cycle.id}`);
    const panel = page.getByRole("region", {name: "Коммерческие условия"});
    await panel.getByLabel("Источник условий").selectOption(`catalog:${brows.id}`);
    const future = new Date(Date.now()+7*86400000).toISOString().slice(0,16);
    await panel.getByLabel("Пересмотреть условия (местное время устройства)").fill(future);
    await panel.getByLabel("Причина подтверждения условий").fill("Original confirmed terms");
    let dropped = false;
    await page.route(`**/deals/${cycle.id}`, async route => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true; await route.fetch(); await route.abort("failed");
      } else await route.continue();
    });
    await panel.getByRole("button", {name: "Подтвердить условия", exact: true}).click();
    await expect.poll(async () => (await db.select().from(s.cycleCommercialTerms).where(eq(s.cycleCommercialTerms.cycleId, cycle.id))).length).toBe(1);
    await expect(panel.getByRole("button", {name: "Подтвердить условия", exact: true})).toBeEnabled();
    await panel.getByRole("button", {name: "Подтвердить условия", exact: true}).click();
    await expect(panel.getByText("Условия подтверждены", {exact: true})).toBeVisible();
    await expect(panel.getByText("Текущие условия · редакция 1", {exact: true})).toBeVisible();
    const [original] = await db.select().from(s.cycleCommercialTerms).where(eq(s.cycleCommercialTerms.cycleId, cycle.id));
    await panel.getByLabel("Пересмотреть условия (местное время устройства)").fill(new Date(Date.now()+14*86400000).toISOString().slice(0,16));
    await panel.getByLabel("Причина подтверждения условий").fill("Human approved extension");
    await panel.getByRole("button", {name: "Подтвердить условия", exact: true}).click();
    await expect(panel.getByText("Текущие условия · редакция 2", {exact: true})).toBeVisible();
    expect((await db.select().from(s.cycleCommercialTerms).where(eq(s.cycleCommercialTerms.id, original.id)))[0]).toEqual(original);
    await page.reload(); await expect(panel.getByText("История условий · редакция 1", {exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    try { if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
