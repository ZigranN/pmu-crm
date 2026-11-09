import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

test.describe("Phase 20 - Authentication, Studio Context, Role Matrix & Navigation", () => {
  test("Req 4: Authentication flow (login, logout, invalid credentials, protected route redirect, session persistence)", async ({ page, context }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `auth-flow-${randomUUID()}@example.test`;
    const password = "Strong-Password-123!";
    let studioId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Auth Tester", email, password },
      });
      expect(response.status()).toBe(200);
      const user = (await response.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values({ studioId, userId: user.id, roleId: role.id });

      // 1. Direct unauthenticated navigation to protected route redirects to login
      await context.clearCookies();
      await page.goto("/clients");
      await expect(page).toHaveURL(/\/login/);

      // 2. Invalid credentials display error
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("WrongPassword123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page.getByText(/Неверный email или пароль|Invalid|Ошибка/i)).toBeVisible();

      // 3. Valid credentials log in and navigate into CRM
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard|\/clients/);

      // 4. Session persistence across new page in same browser context
      const newPage = await context.newPage();
      await newPage.goto("/dashboard");
      await expect(newPage.getByRole("heading", { name: /Добро пожаловать/i })).toBeVisible();
      await newPage.close();

      // 5. Logout terminates session
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Выйти" }).click();
      await expect(page).toHaveURL(/\/login/);

      // 6. Protected route is inaccessible after logout
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/login/);
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

  test("Req 2: Studio context switching and cross-studio tenant isolation", async ({ page }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const email = `multi-studio-${randomUUID()}@example.test`;
    let studioAId: string | undefined;
    let studioBId: string | undefined;

    try {
      const response = await registerTestUser(page.request, {
        data: { name: "Multi Studio User", email, password: "Synthetic-password-123!" },
      });
      expect(response.status()).toBe(200);
      const user = (await response.json()).user;

      [studioAId] = (await db.insert(s.studios).values({ ...studioFixture(), name: "Studio Alfa Milano" }).returning()).map((r) => r.id);
      [studioBId] = (await db.insert(s.studios).values({ ...studioFixture(), name: "Studio Beta Roma" }).returning()).map((r) => r.id);

      const [role] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      await db.insert(s.studioMembers).values([
        { studioId: studioAId, userId: user.id, roleId: role.id },
        { studioId: studioBId, userId: user.id, roleId: role.id },
      ]);

      // Create distinct entities in both studios with similar names
      await db.insert(s.clients).values({
        ...clientFixture(studioAId),
        firstName: "Elena",
        lastName: "Milano",
        fullName: "Elena Milano",
      });

      const [clientB] = await db.insert(s.clients).values({
        ...clientFixture(studioBId),
        firstName: "Elena",
        lastName: "Roma",
        fullName: "Elena Roma",
      }).returning();

      // Login
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // Select Studio Alfa Milano from StudioSelector
      await page.getByText("Studio Alfa Milano").click();
      await expect(page.getByRole("heading", { name: /Добро пожаловать/i })).toBeVisible();

      // Verify active studio displays only Studio Alfa Milano data
      await page.goto("/clients");
      await expect(page.getByText("Elena Milano", { exact: true })).toBeVisible();
      await expect(page.getByText("Elena Roma", { exact: true })).toHaveCount(0);

      // Req 58: Attempting to directly open Studio B's client when Studio A is active results in safe 404
      await page.goto(`/clients/${clientB.id}`);
      await expect(page.getByText("404")).toBeVisible();
    } finally {
      try {
        if (studioAId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioAId));
          await db.delete(s.studios).where(eq(s.studios.id, studioAId));
        }
        if (studioBId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioBId));
          await db.delete(s.studios).where(eq(s.studios.id, studioBId));
        }
        await db.delete(s.user).where(eq(s.user.email, email));
      } finally {
        await database.close();
      }
    }
  });

  test("Req 6 & 7: Role matrix UI boundaries and canonical navigation certification", async ({ page, request }) => {
    test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
    if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");

    const database = await createTestDatabase();
    const db = database.db;
    const suffix = randomUUID();
    const ownerEmail = `owner-${suffix}@example.test`;
    const masterEmail = `master-${suffix}@example.test`;
    let studioId: string | undefined;

    try {
      const ownerRes = await registerTestUser(page.request, {
        data: { name: "Owner User", email: ownerEmail, password: "Synthetic-password-123!" },
      });
      expect(ownerRes.status()).toBe(200);
      const owner = (await ownerRes.json()).user;

      const masterRes = await registerTestUser(request, {
        data: { name: "Master User", email: masterEmail, password: "Synthetic-password-123!" },
      });
      expect(masterRes.status()).toBe(200);
      const masterUser = (await masterRes.json()).user;

      [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
      const [ownerRole] = await db.select().from(s.roles).where(eq(s.roles.code, "OWNER"));
      const [masterRole] = await db.select().from(s.roles).where(eq(s.roles.code, "MASTER"));

      await db.insert(s.masters).values({
        studioId,
        displayName: "Master Profile",
        userId: masterUser.id,
      });

      await db.insert(s.studioMembers).values([
        { studioId, userId: owner.id, roleId: ownerRole.id },
        { studioId, userId: masterUser.id, roleId: masterRole.id },
      ]);

      // --- SECTION 1: OWNER verifies canonical navigation (Req 7) ---
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      const routesToVerify = [
        { path: "/dashboard", header: /Панель управления|Дашборд/i },
        { path: "/clients", header: /Клиенты/i },
        { path: "/calendar", header: /Календарь/i },
        { path: "/needs-attention", header: /Требуют внимания/i },
        { path: "/conversations", header: /Сообщения|Диалоги/i },
        { path: "/handoffs", header: /Передачи|Handoffs/i },
        { path: "/automations", header: /Автоматизации/i },
        { path: "/operations", header: /Операции|Operations/i },
        { path: "/settings", header: /Настройки/i },
        { path: "/settings/privacy", header: /Конфиденциальность|Privacy/i },
        { path: "/settings/audit", header: /История изменений/i },
        { path: "/settings/jobs", header: /Обработка событий|Задачи/i },
      ];

      for (const route of routesToVerify) {
        await page.goto(route.path);
        expect(page.url()).toContain(route.path);
        // Verify no 404 or application crash
        await expect(page.getByRole("heading", { name: "404", exact: true })).toHaveCount(0);
        await expect(page.getByText("This page could not be found")).toHaveCount(0);
        await expect(page.getByText("Application error")).toHaveCount(0);
      }

      // --- SECTION 2: MASTER UI role scoping & direct route authorization denial (Req 6) ---
      await page.getByRole("button", { name: "Выйти" }).click();
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(masterEmail);
      await page.getByLabel("Пароль", { exact: true }).fill("Synthetic-password-123!");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard/);

      // Master can view clients and calendar
      await page.goto("/clients");
      await expect(page).toHaveURL(/\/clients/);

      // Direct navigation by MASTER to admin/owner routes redirects safely to dashboard
      const deniedAdminRoutes = [
        "/settings/team",
        "/settings/audit",
        "/settings/jobs",
        "/operations",
      ];

      for (const adminRoute of deniedAdminRoutes) {
        await page.goto(adminRoute);
        // Either redirected to dashboard or showing 404/denied safely
        await expect(page).toHaveURL(/\/dashboard/);
      }
    } finally {
      try {
        if (studioId) {
          await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
          await db.delete(s.studios).where(eq(s.studios.id, studioId));
        }
        await db.delete(s.user).where(inArray(s.user.email, [ownerEmail, masterEmail]));
      } finally {
        await database.close();
      }
    }
  });
});
