import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test("client retry after lost response and reload returns original client; Owner recovers a failed job", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `command-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await page.request.post("/api/auth/sign-up/email", { data: { name: "Synthetic Owner", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(r => r.id);
    const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
    await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/clients/new");
    const fill = async () => { await page.getByLabel("Имя", { exact: true }).fill("Retry client"); await page.getByLabel("Телефон", { exact: true }).fill("+390000000000"); };
    await fill();
    let lost = false;
    await page.route("**/clients/new", async route => {
      if (!lost && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        lost = true; await route.fetch(); await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect.poll(async () => (await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId!))).length).toBe(1);
    await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled();
    const [original] = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    expect(lost).toBe(true);
    await page.unroute("**/clients/new"); await page.reload(); await fill();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${original.id}$`));
    expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
    const [job] = await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioId));
    await db.update(s.outboxJobs).set({ state: "dead", lastError: "handler_failure" }).where(eq(s.outboxJobs.id, job.id));
    await page.goto("/settings/jobs");
    await expect(page.getByRole("heading", { name: "Обработка событий" })).toBeVisible();
    await page.getByLabel("Причина восстановления").fill("Dependency restored");
    await page.getByRole("button", { name: "Повторить обработку", exact: true }).click();
    await expect(page.getByText("Задач в этом списке нет.")).toBeVisible();
    expect((await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.id, job.id)))[0].state).toBe("pending");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    try { if (studioId) { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); }
      await db.delete(s.user).where(eq(s.user.email, email)); }
    finally { await database.close(); }
  }
});
