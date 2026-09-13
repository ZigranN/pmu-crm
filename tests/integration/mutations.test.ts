import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";

const session = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.id ? { user: { id: session.id } } : null } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let masterActions: typeof import("@/features/masters/server/actions");
let masterQueries: typeof import("@/features/masters/server/queries");
let medical: typeof import("@/features/medical/server/actions");
let legacyMedical: typeof import("@/features/clients/server/medical-actions");
let media: typeof import("@/features/media/server/service");
let consent: typeof import("@/features/consent/server/service");
let mediaActions: typeof import("@/features/media/server/actions");
const userId = randomUUID();
let studioId: string, foreignStudioId: string, clientId: string, foreignClientId: string;
let serviceId: string, foreignServiceId: string, masterId: string, foreignMasterId: string, roleId: string;
const addedPermissions: string[] = [];
const codes = ["MASTER_CREATE", "MASTER_UPDATE", "MASTER_ARCHIVE", "MASTER_READ", "MEDICAL_PROFILE_UPDATE", "MEDIA_CREATE", "CONSENT_UPLOAD", "CONSENT_READ"];
const masterInput = { displayName: "Synthetic Master", calendarColor: "#8B6F5A", isActive: true };
const medicalInput = { previousPMU: false, herpesHistory: false, diabetes: false, bloodThinners: false,
  keloidRisk: false, autoimmuneDiseases: false, recentBotoxFillers: false, recentPeelingLaser: false, skinSensitivity: false };

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;
  vi.doMock("@/db", () => ({ db }));
  masterActions = await import("@/features/masters/server/actions");
  masterQueries = await import("@/features/masters/server/queries");
  medical = await import("@/features/medical/server/actions");
  legacyMedical = await import("@/features/clients/server/medical-actions");
  media = await import("@/features/media/server/service");
  consent = await import("@/features/consent/server/service");
  mediaActions = await import("@/features/media/server/actions");
  [studioId, foreignStudioId] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map((r) => r.id);
  await db.insert(s.user).values({ id: userId, name: "Synthetic", email: `${userId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  [roleId] = (await db.insert(s.roles).values({ code: `TEST_${randomUUID()}`, name: "Test mutations" }).returning()).map((r) => r.id);
  await db.insert(s.studioMembers).values({ studioId, userId, roleId });
  addedPermissions.push(...(await db.insert(s.permissions).values(codes.map((code) => ({ code, name: code }))).onConflictDoNothing().returning()).map((r) => r.id));
  const permissions = await db.select().from(s.permissions).where(inArray(s.permissions.code, codes));
  await db.insert(s.rolePermissions).values(permissions.map((p) => ({ roleId, permissionId: p.id })));
  [clientId, foreignClientId] = (await db.insert(s.clients).values([clientFixture(studioId), clientFixture(foreignStudioId)]).returning()).map((r) => r.id);
  [serviceId, foreignServiceId] = (await db.insert(s.services).values([studioId, foreignStudioId].map((id) => ({ studioId: id, name: "Synthetic service", category: "brows" as const, procedureType: "brows" as const, durationMinutes: 60, priceCents: 10000 }))).returning()).map((r) => r.id);
  [masterId, foreignMasterId] = (await db.insert(s.masters).values([studioId, foreignStudioId].map((id) => ({ ...masterInput, studioId: id }))).returning()).map((r) => r.id);
  await db.insert(s.masterServices).values([{ studioId, masterId, serviceId }, { studioId: foreignStudioId, masterId: foreignMasterId, serviceId: foreignServiceId }]);
});

beforeEach(async () => {
  session.id = userId;
  await database.db.delete(s.userCustomPermissions).where(eq(s.userCustomPermissions.userId, userId));
  vi.mocked(uploadToCloudinary).mockReset().mockImplementation(async () => ({ url: "https://example.test/file", publicId: `synthetic-${randomUUID()}` }));
  vi.mocked(deleteFromCloudinary).mockReset().mockResolvedValue(undefined);
  await database.db.update(s.clients).set({ deletedAt: null }).where(eq(s.clients.id, clientId));
});

afterAll(async () => {
  if (!database) return;
  try {
    await database.db.delete(s.auditLogs).where(eq(s.auditLogs.userId, userId));
    await database.db.delete(s.user).where(eq(s.user.id, userId));
    if (studioId) await database.db.delete(s.studios).where(inArray(s.studios.id, [studioId, foreignStudioId]));
    if (roleId) await database.db.delete(s.roles).where(eq(s.roles.id, roleId));
    if (addedPermissions.length) await database.db.delete(s.permissions).where(inArray(s.permissions.id, addedPermissions));
  } finally { await database.close(); }
});

// A real database error AFTER entity writes proves transaction rollback.
async function failAudit(entityId: string, run: () => Promise<void>) {
  const name = `test_fail_${randomUUID().replaceAll("-", "")}`;
  if (!/^[a-f0-9-]+$/.test(entityId)) throw new Error("Invalid fixture id");
  await database.db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = '${entityId}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`));
  try {
    await database.db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    await run();
  } finally {
    await database.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`));
    await database.db.execute(sql.raw(`DROP FUNCTION ${name}()`));
  }
}

async function links(id: string) { return database.db.select().from(s.masterServices).where(eq(s.masterServices.masterId, id)); }
function mediaInput(target = clientId) { return { studioId, clientId: target, type: "before" as const, createdById: userId }; }
function file() { return new File(["synthetic"], "test.txt", { type: "text/plain" }); }

test("master edit query loads assigned services and rename preserves them", async () => {
  const loaded = await masterQueries.getMasterById(masterId, studioId);
  expect(loaded?.services.map((l) => l.serviceId)).toEqual([serviceId]);
  await masterActions.updateMasterAction(masterId, { ...masterInput, displayName: "Renamed", serviceIds: loaded!.services.map((l) => l.serviceId) });
  await masterActions.updateMasterAction(masterId, { ...masterInput, displayName: "Renamed again" });
  expect((await links(masterId)).map((l) => l.serviceId)).toEqual([serviceId]);
});

test("foreign master and service IDs leave data unchanged", async () => {
  const before = await links(foreignMasterId);
  await expect(masterActions.updateMasterAction(foreignMasterId, { ...masterInput, serviceIds: [] })).rejects.toThrow("Master not found");
  expect(await links(foreignMasterId)).toEqual(before);
  await expect(masterActions.updateMasterAction(masterId, { ...masterInput, serviceIds: [foreignServiceId] })).rejects.toThrow();
  expect((await links(masterId)).map((l) => l.serviceId)).toEqual([serviceId]);
});

test("duplicate services reject; explicit empty selection removes only own links", async () => {
  await expect(masterActions.createMasterAction({ ...masterInput, serviceIds: [serviceId, serviceId] })).rejects.toThrow();
  const created = await masterActions.createMasterAction({ ...masterInput, serviceIds: [serviceId] });
  await masterActions.updateMasterAction(created.id, { ...masterInput, serviceIds: [] });
  expect(await links(created.id)).toEqual([]);
  expect(await links(foreignMasterId)).toHaveLength(1);
});

test("failed audit rolls back master fields AND service replacement", async () => {
  const [before] = await database.db.select().from(s.masters).where(eq(s.masters.id, masterId));
  await failAudit(masterId, async () => {
    await expect(masterActions.updateMasterAction(masterId, { ...masterInput, displayName: "Must rollback", serviceIds: [] })).rejects.toThrow();
  });
  expect((await database.db.select().from(s.masters).where(eq(s.masters.id, masterId)))[0]).toEqual(before);
  expect((await links(masterId)).map((l) => l.serviceId)).toEqual([serviceId]);
});

test("foreign/missing master archive and restore cannot report success", async () => {
  await expect(masterActions.archiveMasterAction(foreignMasterId)).rejects.toThrow("Master not found");
  await expect(masterActions.restoreMasterAction(randomUUID())).rejects.toThrow("Master not found");
});

test("both medical action contracts reject foreign clients and share one profile", async () => {
  await expect(medical.upsertMedicalProfileAction(foreignClientId, medicalInput)).rejects.toThrow("Client not found");
  await expect(legacyMedical.updateMedicalProfileAction(foreignClientId, medicalInput)).rejects.toThrow("Client not found");
  await medical.upsertMedicalProfileAction(clientId, { ...medicalInput, medicalNotes: "first" });
  await legacyMedical.updateMedicalProfileAction(clientId, { ...medicalInput, medicalNotes: "second" });
  const rows = await database.db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, clientId));
  expect(rows).toHaveLength(1); expect(rows[0].medicalNotes).toBe("second");
});

test("medical update and activity rollback if audit cannot be saved", async () => {
  await medical.upsertMedicalProfileAction(clientId, { ...medicalInput, medicalNotes: "second" });
  const events = await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId));
  await failAudit(clientId, async () => {
    await expect(medical.upsertMedicalProfileAction(clientId, { ...medicalInput, medicalNotes: "rollback" })).rejects.toThrow();
  });
  expect((await database.db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId, clientId)))[0].medicalNotes).toBe("second");
  expect(await database.db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, clientId))).toEqual(events);
});

test("foreign/archived client and invalid appointment are rejected before upload", async () => {
  await expect(media.mediaService.uploadMedia(file(), mediaInput(foreignClientId))).rejects.toThrow("Client not found");
  await expect(media.mediaService.uploadMedia(file(), { ...mediaInput(), appointmentId: randomUUID() })).rejects.toThrow("Appointment not found");
  await database.db.update(s.clients).set({ deletedAt: new Date() }).where(eq(s.clients.id, clientId));
  await expect(media.mediaService.uploadMedia(file(), mediaInput())).rejects.toThrow("Client not found");
  expect(uploadToCloudinary).not.toHaveBeenCalled();
});

test("direct upload action rejects unauthenticated callers", async () => {
  session.id = null;
  await expect(mediaActions.uploadMediaAction(new FormData())).rejects.toThrow("Unauthorized");
  expect(uploadToCloudinary).not.toHaveBeenCalled();
});

test("failed associated save rolls back media and compensates provider upload", async () => {
  const before = await database.db.select().from(s.media).where(eq(s.media.clientId, clientId));
  await expect(media.withMediaUpload(file(), mediaInput(), async () => { throw new Error("synthetic linked record failure"); })).rejects.toThrow();
  expect(await database.db.select().from(s.media).where(eq(s.media.clientId, clientId))).toEqual(before);
  expect(deleteFromCloudinary).toHaveBeenCalledTimes(1);
});

test("consent upload validates owner and archive preserves document and file", async () => {
  const input = { studioId, clientId, consentType: "pmu_general" as const, signedAt: new Date(), createdById: userId };
  await expect(consent.consentService.uploadConsent(file(), { ...input, clientId: foreignClientId })).rejects.toThrow("Client not found");
  expect(uploadToCloudinary).not.toHaveBeenCalled();
  const created = await consent.consentService.uploadConsent(file(), input);
  await expect(consent.consentService.deleteConsent(created.id, studioId, userId, foreignClientId)).rejects.toThrow("Consent not found");
  expect(await consent.consentService.getClientConsents(clientId, studioId)).toHaveLength(1);
  await consent.consentService.deleteConsent(created.id, studioId, userId, clientId);
  expect(await consent.consentService.getClientConsents(clientId, studioId)).toEqual([]);
  expect(await database.db.select().from(s.consents).where(eq(s.consents.id, created.id))).toHaveLength(1);
  expect((await database.db.select().from(s.media).where(eq(s.media.id, created.mediaId)))[0].deletedAt).not.toBeNull();
  expect(deleteFromCloudinary).not.toHaveBeenCalled();
});


test("same-studio appointment for another client cannot be attached to media", async () => {
  const [other] = await database.db.insert(s.clients).values(clientFixture(studioId)).returning();
  const [appointment] = await database.db.insert(s.appointments).values({
    studioId, clientId: other.id, masterId, serviceId, startAt: new Date("2026-10-01T10:00:00Z"),
    endAt: new Date("2026-10-01T11:00:00Z"), source: "other", createdById: userId,
    serviceSnapshot: {}, clientSnapshot: {}, masterSnapshot: {}, priceSnapshotCents: 10000, durationSnapshotMinutes: 60,
  }).returning();
  await expect(media.mediaService.uploadMedia(file(), { ...mediaInput(), appointmentId: appointment.id })).rejects.toThrow("Appointment not found");
  expect(uploadToCloudinary).not.toHaveBeenCalled();
});

test("resource archived during upload is rechecked and uploaded file is compensated", async () => {
  vi.mocked(uploadToCloudinary).mockImplementationOnce(async () => {
    await database.db.update(s.clients).set({ deletedAt: new Date() }).where(eq(s.clients.id, clientId));
    return { url: "https://example.test/unpublished", publicId: "synthetic-unpublished" };
  });
  await expect(media.mediaService.uploadMedia(file(), mediaInput())).rejects.toThrow("Client not found");
  expect(deleteFromCloudinary).toHaveBeenCalledWith("synthetic-unpublished");
});

test("MEDIA_CREATE cannot bypass CONSENT_UPLOAD on generic archive action", async () => {
  const uploaded = await media.mediaService.uploadMedia(file(), { ...mediaInput(), type: "consent" });
  const [permission] = await database.db.select().from(s.permissions).where(eq(s.permissions.code, "CONSENT_UPLOAD"));
  await database.db.insert(s.userCustomPermissions).values({ studioId, userId, permissionId: permission.id, effect: "deny" });
  await expect(mediaActions.deleteMediaAction(uploaded.id)).rejects.toThrow("Permission denied");
  expect((await database.db.select().from(s.media).where(eq(s.media.id, uploaded.id)))[0].deletedAt).toBeNull();
  expect(deleteFromCloudinary).not.toHaveBeenCalled();
});
