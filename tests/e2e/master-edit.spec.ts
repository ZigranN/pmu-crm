import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";

// CI always supplies PostgreSQL; local HTTP-only mode does not run this suite.
test("renaming a master in the browser preserves assigned services", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires the disposable PostgreSQL service");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase();
  const db = database.db;
  const suffix = randomUUID();
  const email = `${suffix}@example.test`;
  let studioId: string | undefined, roleId: string | undefined;
  const permissionIds: string[] = [];
  try {
    const response = await page.request.post("/api/auth/sign-up/email", { data: {
      name: "Synthetic browser user", email, password: "Synthetic-password-123!",
    } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map((r) => r.id);
    [roleId] = (await db.insert(s.roles).values({ code: `TEST_${suffix}`, name: "Synthetic editor" }).returning()).map((r) => r.id);
    const codes = ["MASTER_READ", "MASTER_UPDATE", "SERVICE_READ"];
    permissionIds.push(...(await db.insert(s.permissions).values(codes.map((code) => ({ code, name: code }))).onConflictDoNothing().returning()).map((r) => r.id));
    const permissions = await db.select().from(s.permissions).where(inArray(s.permissions.code, codes));
    await db.insert(s.rolePermissions).values(permissions.map((p) => ({ roleId: roleId!, permissionId: p.id })));
    await db.insert(s.studioMembers).values({ studioId, userId: body.user.id, roleId });
    const [service] = await db.insert(s.services).values({ studioId, name: "Synthetic brows", category: "brows", procedureType: "brows", durationMinutes: 60, priceCents: 10000 }).returning();
    const [master] = await db.insert(s.masters).values({ studioId, displayName: "Before rename", calendarColor: "#8B6F5A" }).returning();
    await db.insert(s.masterServices).values({ studioId, masterId: master.id, serviceId: service.id });
    await page.goto(`/masters/${master.id}/edit`);
    await expect(page.getByRole("checkbox", { name: "Synthetic brows" })).toBeChecked();
    await page.getByLabel("Имя мастера", { exact: true }).fill("After rename");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page).toHaveURL(/\/masters$/);
    const [saved] = await db.select().from(s.masters).where(eq(s.masters.id, master.id));
    expect(saved.displayName).toBe("After rename");
    const links = await db.select().from(s.masterServices).where(eq(s.masterServices.masterId, master.id));
    expect(links.map((l) => l.serviceId)).toEqual([service.id]);
    await page.goto(`/masters/${master.id}/edit`);
    await expect(page.getByRole("checkbox", { name: "Synthetic brows" })).toBeChecked();
  } finally {
    try {
      if (studioId) await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
      await db.delete(s.user).where(eq(s.user.email, email));
      if (studioId) await db.delete(s.studios).where(eq(s.studios.id, studioId));
      if (roleId) await db.delete(s.roles).where(eq(s.roles.id, roleId));
      if (permissionIds.length) await db.delete(s.permissions).where(inArray(s.permissions.id, permissionIds));
    } finally { await database.close(); }
  }
});
