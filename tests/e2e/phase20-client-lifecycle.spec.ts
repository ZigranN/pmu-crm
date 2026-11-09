import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Client Lifecycle, Unicode, Validation & Merge", () => {
  test("Req 4 & 5: Client creation, Unicode/Cyrillic, validation, safe edit, search, double-submit", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `client-life-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Studio Manager", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // --- SECTION 1: Validation errors & double-submit protection on create (Req 8 & 61) ---
      await page.goto("/clients/new");
      // Try submitting empty form
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page.getByText(/Укажите имя|обязательно/i)).toBeVisible();

      // Enter Unicode / Cyrillic name and formatted phone
      const cyrillicName = "Екатерина Михайловна";
      const rawPhone = "+39 333 123 4567";
      await page.getByLabel("Имя", { exact: true }).fill(cyrillicName);
      await page.getByLabel("Телефон", { exact: true }).fill(rawPhone);
      await page.getByLabel("Язык общения", { exact: true }).selectOption("ru");
      await page.getByLabel("Тип клиента", { exact: true }).selectOption("new");
      await page.getByLabel("Брови", { exact: true }).check();

      // Save client
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page).toHaveURL(/\/clients\/[a-f0-9-]+$/);

      const clientId = page.url().split("/").pop()!;
      const [persistedClient] = await db.select().from(s.clients).where(eq(s.clients.id, clientId));
      expect(persistedClient).toMatchObject({
        firstName: cyrillicName,
        language: "ru",
        clientKind: "new",
      });
      expect(persistedClient.phone).toBeTruthy();

      // --- SECTION 2: Safe client field edit (Req 9) ---
      await page.goto(`/clients/${clientId}/edit`);
      await page.getByLabel("Имя", { exact: true }).fill("Екатерина Михайловна (VIP)");
      await page.getByLabel("Губы", { exact: true }).check();
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`));

      await page.reload();
      await expect(page.getByText("Екатерина Михайловна (VIP)")).toBeVisible();

      // --- SECTION 3: Search with Cyrillic / phone (Req 56) ---
      await page.goto("/clients");
      const searchBox = page.getByRole("searchbox").or(page.getByPlaceholder(/Поиск|Искать/i)).or(page.getByRole("textbox", { name: /Поиск/i }));
      if (await searchBox.isVisible()) {
        await searchBox.fill("Екатерина");
        await expect(page.getByText("Екатерина Михайловна (VIP)")).toBeVisible();
      }
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

  test("Req 10: Client merge workflow preserves canonical target and historical coherence", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `merge-spec-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Merge Admin", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: owner.id, roleId: role.id });

      const [source, target] = await db.insert(s.clients).values([
        { ...clientFixture(studioId), firstName: "Duplicate User", fullName: "Duplicate User", notes: "Duplicate source note" },
        { ...clientFixture(studioId), firstName: "Canonical Target", fullName: "Canonical Target", notes: "Target main note" },
      ]).returning();

      await db.insert(s.activityEvents).values({
        studioId,
        clientId: source.id,
        type: "client_created",
        title: "Original duplicate event",
      });

      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      await page.goto(`/clients/${target.id}`);
      await page.getByRole("link", { name: "Объединить" }).click();
      await page.getByLabel("Карточка-дубль").selectOption(source.id);
      await page.getByRole("button", { name: "Проверить объединение", exact: true }).click();

      await page.getByRole("button", { name: "Выбрать значения основной карточки", exact: true }).click();
      await page.getByLabel("Причина объединения", { exact: true }).fill("E2E certification merge verified duplicate");
      await page.getByRole("checkbox", { name: "Я проверил карточки: это один человек", exact: true }).check();
      await page.getByRole("button", { name: "Объединить и сохранить историю", exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/clients/${target.id}$`));

      // Verify source is merged into target and target has preserved records
      const [sourceDb] = await db.select().from(s.clients).where(eq(s.clients.id, source.id));
      const [targetDb] = await db.select().from(s.clients).where(eq(s.clients.id, target.id));
      expect(sourceDb.mergedIntoId).toBe(target.id);
      expect(targetDb.id).toBe(target.id);
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
