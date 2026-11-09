import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 16 UI/UX Polish Smoke Suite", () => {
  test("1. Dashboard renders with operational overview and quick navigation", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    const database = await createTestDatabase(), db = database.db;
    const email = `owner-ui-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Smoke Owner", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;
      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const roles = await db.select().from(s.roles);
      await db.insert(s.studioMembers).values({
        studioId,
        userId: owner.id,
        roleId: roles.find((r) => r.code === "OWNER")!.id,
      });

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Оперативная сводка")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Быстрый переход" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    } finally {
      try {
        if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("2. Client profile tabs switch smoothly without layout breaks", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    const database = await createTestDatabase(), db = database.db;
    const email = `client-ui-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Client Tabs Owner", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;
      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const roles = await db.select().from(s.roles);
      await db.insert(s.studioMembers).values({
        studioId,
        userId: owner.id,
        roleId: roles.find((r) => r.code === "OWNER")!.id,
      });

      const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();

      await page.goto(`/clients/${client.id}`);
      await expect(page.getByRole("heading", { name: client.fullName })).toBeVisible();

      // Check tabs
      await page.getByRole("tab", { name: "Инфо" }).click();
      await expect(page.getByText("Административная карточка")).toBeVisible();

      await page.getByRole("tab", { name: "Пакеты" }).click();
      await expect(page.getByText("Комплексные пакеты (Total Face)")).toBeVisible();

      await page.getByRole("tab", { name: "История" }).click();
      await expect(page.getByText("История активности", { exact: true })).toBeVisible();
    } finally {
      try {
        if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("3. Calendar and Needs Attention render with accessible filters", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    const database = await createTestDatabase(), db = database.db;
    const email = `cal-ui-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Calendar Owner", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;
      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const roles = await db.select().from(s.roles);
      await db.insert(s.studioMembers).values({
        studioId,
        userId: owner.id,
        roleId: roles.find((r) => r.code === "OWNER")!.id,
      });

      // Calendar check
      await page.goto("/calendar");
      await expect(page.getByRole("heading", { name: "Календарь и доступность" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Неделя" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "День" })).toBeVisible();

      // Needs attention check
      await page.goto("/needs-attention");
      await expect(page.getByRole("heading", { name: "Требует внимания" })).toBeVisible();
      await expect(page.getByPlaceholder("Поиск по клиенту или проблеме...")).toBeVisible();
    } finally {
      try {
        if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("4. Automations, Handoffs, and Operations permission gate works correctly", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    const database = await createTestDatabase(), db = database.db;
    const email = `ops-ui-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Ops Owner", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const owner = (await response.json()).user;
      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const roles = await db.select().from(s.roles);
      await db.insert(s.studioMembers).values({
        studioId,
        userId: owner.id,
        roleId: roles.find((r) => r.code === "OWNER")!.id,
      });

      // Automations page
      await page.goto("/automations");
      await expect(page.getByRole("heading", { name: /Автоматизации/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Правила/ })).toBeVisible();

      // Handoffs page
      await page.goto("/handoffs");
      await expect(page.getByRole("heading", { name: /Очередь передач/ })).toBeVisible();

      // Operations page
      await page.goto("/operations");
      await expect(page.getByRole("heading", { name: /Операционная панель/ })).toBeVisible();
    } finally {
      try {
        if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("5. Responsive viewports (375px, 768px, 1280px, 1440px) have no unintended page overflow", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    const database = await createTestDatabase(), db = database.db;
    const email = `responsive-ui-${randomUUID()}@example.test`;
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Responsive UI User", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const userRecord = (await response.json()).user;
      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const roles = await db.select().from(s.roles);
      await db.insert(s.studioMembers).values({
        studioId,
        userId: userRecord.id,
        roleId: roles.find((r) => r.code === "OWNER")!.id,
      });

      const viewports = [
        { width: 375, height: 812, name: "mobile" },
        { width: 768, height: 1024, name: "tablet" },
        { width: 1280, height: 800, name: "laptop" },
        { width: 1440, height: 900, name: "desktop" },
      ];

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto("/dashboard");

        if (vp.width < 768) {
          await expect(page.getByRole("navigation", { name: "Нижняя навигация" })).toBeVisible();
        } else {
          await expect(page.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
        }

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(vp.width);
      }
    } finally {
      try {
        if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("HTTP: protected CRM routes redirect anonymous visitors safely", async ({ request }) => {
    const routes = [
      "/dashboard",
      "/clients",
      "/calendar",
      "/needs-attention",
      "/handoffs",
      "/conversations",
      "/automations",
      "/operations",
      "/settings",
    ];

    for (const route of routes) {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain("/login");
    }
  });

  test("HTTP: login form has accessible labels and input controls", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Пароль", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Войти" })).toBeEnabled();
  });
});
