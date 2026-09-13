import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { hasPermission, PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { normalizeRole, hasRole } from "@/lib/roles";
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let studioId: string;
const userId = randomUUID();
const roleIds = new Map<string, string>();
const permissionIds = new Map<string, string>();
beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(r => r.id);
  await db.insert(s.user).values({ id: userId, name: "Role test", email: `${userId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  for (const role of await db.select().from(s.roles)) roleIds.set(role.code, role.id);
  for (const permission of await db.select().from(s.permissions)) permissionIds.set(permission.code, permission.id);
  await db.insert(s.studioMembers).values({ userId, studioId, roleId: roleIds.get("ADMIN")! });
});
beforeEach(async () => {
  await database.db.delete(s.userCustomPermissions).where(eq(s.userCustomPermissions.userId, userId));
  await database.db.update(s.studioMembers).set({ isActive: true, roleId: roleIds.get("ADMIN")! }).where(eq(s.studioMembers.userId, userId));
});
afterAll(async () => {
  if (!database) return;
  try { await database.db.delete(s.user).where(eq(s.user.id, userId)); await database.db.delete(s.studios).where(eq(s.studios.id, studioId)); }
  finally { await database.close(); }
});
const adminAllowed = new Set(`OFFER_READ OFFER_MANAGE CLIENT_READ CLIENT_CREATE CLIENT_UPDATE CLIENT_ARCHIVE MEDICAL_PROFILE_READ APPOINTMENT_READ APPOINTMENT_CREATE APPOINTMENT_UPDATE APPOINTMENT_CANCEL APPOINTMENT_NO_SHOW MEDIA_READ MEDIA_CREATE CONSENT_READ CONSENT_UPLOAD PAYMENT_READ PAYMENT_MARK_DEPOSIT SERVICE_READ MASTER_READ WHATSAPP_TEMPLATE_READ WHATSAPP_TEMPLATE_USE TASK_READ TASK_CREATE TASK_UPDATE REVIEW_READ REVIEW_CREATE`.split(" "));
const masterAllowed = new Set(`CLIENT_READ CLIENT_UPDATE MEDICAL_PROFILE_READ MEDICAL_PROFILE_UPDATE APPOINTMENT_READ APPOINTMENT_COMPLETE APPOINTMENT_NO_SHOW PROCEDURE_READ PROCEDURE_CREATE PROCEDURE_UPDATE MEDIA_READ MEDIA_CREATE CONSENT_READ CONSENT_UPLOAD PAYMENT_READ PAYMENT_MARK_DEPOSIT SERVICE_READ MASTER_READ WHATSAPP_TEMPLATE_READ WHATSAPP_TEMPLATE_USE TASK_READ TASK_CREATE TASK_UPDATE REVIEW_READ REVIEW_CREATE`.split(" "));
test.each(["OWNER", "ADMIN", "MASTER", "AI_SYSTEM"])("%s capability matrix against migrated grants", async (role) => {
  await database.db.update(s.studioMembers).set({ roleId: roleIds.get(role)! }).where(eq(s.studioMembers.userId, userId));
  for (const permission of Object.values(PERMISSIONS)) {
    const expected = role === "OWNER" || (role === "ADMIN" && adminAllowed.has(permission)) || (role === "MASTER" && masterAllowed.has(permission));
    expect(await hasPermission(database.db, userId, studioId, permission), `${role}/${permission}`).toBe(expected);
  }
  expect(await hasRole(database.db, userId, studioId, "OWNER")).toBe(role === "OWNER");
});
test.each(["ADMIN", "MASTER", "AI_SYSTEM"])("%s cannot bypass hard prohibitions using allow overrides", async (role) => {
  await database.db.update(s.studioMembers).set({ roleId: roleIds.get(role)! }).where(eq(s.studioMembers.userId, userId));
  const forbidden: PermissionCode[] = ["PAYMENT_REFUND", "SETTINGS_UPDATE", "ROLES_MANAGE", "SERVICE_UPDATE"];
  if (role !== "MASTER") forbidden.push("MEDICAL_PROFILE_UPDATE");
  await database.db.insert(s.userCustomPermissions).values(forbidden.map(code => ({ userId, studioId, permissionId: permissionIds.get(code)!, effect: "allow" as const })));
  for (const code of forbidden) expect(await hasPermission(database.db, userId, studioId, code)).toBe(false);
});
test("auth role cannot elevate membership; exact deny, unknown permission and inactive membership fail closed", async () => {
  expect(await hasPermission(database.db, userId, studioId, "PAYMENT_REFUND")).toBe(false);
  await database.db.insert(s.userCustomPermissions).values([
    { userId, studioId, permissionId: permissionIds.get("CLIENT_READ")!, effect: "allow" },
    { userId, studioId, permissionId: permissionIds.get("MEDICAL_PROFILE_READ")!, effect: "deny" },
  ]);
  expect(await hasPermission(database.db, userId, studioId, "CLIENT_READ")).toBe(true);
  expect(await hasPermission(database.db, userId, studioId, "MEDICAL_PROFILE_READ")).toBe(false);
  expect(await hasPermission(database.db, userId, studioId, "UNKNOWN" as PermissionCode)).toBe(false);
  await database.db.update(s.studioMembers).set({ roleId: roleIds.get("OWNER")!, isActive: false }).where(eq(s.studioMembers.userId, userId));
  expect(await hasPermission(database.db, userId, studioId, "CLIENT_READ")).toBe(false);
  expect(await hasPermission(database.db, userId, randomUUID(), "CLIENT_READ")).toBe(false);
});
test("legacy role mapping is explicit and unknown names never become Owner", () => {
  expect(normalizeRole("SUPER_ADMIN")).toBe("OWNER");
  expect(normalizeRole("STUDIO_ADMIN")).toBe("OWNER");
  expect(normalizeRole("ASSISTANT")).toBe("ADMIN");
  expect(normalizeRole("CLIENT")).toBeNull();
  expect(normalizeRole("owner")).toBeNull();
  expect(normalizeRole("toString")).toBeNull();
});
