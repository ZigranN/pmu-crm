import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const owner = randomUUID(), a = randomUUID(), b = randomUUID(), admin = randomUUID();
let studioId: string, foreignStudio: string, ma: string, mb: string, foreignMaster: string, ca: string, cb: string, unassigned: string;
let mediaA: string, mediaB: string;
let appointmentA: string, appointmentB: string, paymentA: string;
const roleIds = new Map<string, string>();
let clients: typeof import("@/features/clients/server/queries");
let actions: typeof import("@/features/clients/server/actions");
let search: typeof import("@/features/search/server/actions");
let masters: typeof import("@/features/masters/server/queries");
let management: typeof import("@/features/settings/server/role-management");
let medical: typeof import("@/features/medical/server/actions");
let media: typeof import("@/features/media/server/service");
let finance: typeof import("@/features/payments/server/queries");
let calendar: typeof import("@/features/appointments/server/queries");
beforeAll(async () => {
  database = await createTestDatabase(); const db = database.db;
  vi.doMock("@/db", () => ({ db }));
  clients = await import("@/features/clients/server/queries"); actions = await import("@/features/clients/server/actions");
  search = await import("@/features/search/server/actions"); masters = await import("@/features/masters/server/queries");
  management = await import("@/features/settings/server/role-management"); medical = await import("@/features/medical/server/actions");
  media = await import("@/features/media/server/service"); finance = await import("@/features/payments/server/queries"); calendar = await import("@/features/appointments/server/queries");
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(r => r.id);
  await db.insert(s.user).values([owner, a, b, admin].map(id => ({ id, name: "Synthetic", email: `${id}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() })));
  for (const role of await db.select().from(s.roles)) roleIds.set(role.code, role.id);
  await db.insert(s.studioMembers).values([{ userId: owner, roleId: roleIds.get("OWNER")! }, { userId: a, roleId: roleIds.get("MASTER")! }, { userId: b, roleId: roleIds.get("MASTER")! }, { userId: admin, roleId: roleIds.get("ADMIN")! }].map(row => ({ ...row, studioId })));
  [ma, mb, foreignMaster] = (await db.insert(s.masters).values([{ studioId, userId: a, displayName: "Synthetic A" }, { studioId, userId: b, displayName: "Synthetic B" }, { studioId: foreignStudio, displayName: "Foreign" }]).returning()).map(r => r.id);
  [ca, cb, unassigned] = (await db.insert(s.clients).values([{ ...clientFixture(studioId), assignedMasterId: ma, ltvCents: 99999 }, { ...clientFixture(studioId), assignedMasterId: mb }, clientFixture(studioId)]).returning()).map(r => r.id);
  await db.insert(s.clientMedicalProfiles).values([{ clientId: ca, medicalNotes: "Own medical" }, { clientId: cb, medicalNotes: "Other medical" }]);
  [mediaA, mediaB] = (await db.insert(s.media).values([ca, cb].map(clientId => ({ studioId, clientId, type: "before" as const, url: "https://example.test/photo", createdById: owner }))).returning()).map(r => r.id);
  const documents = await db.insert(s.media).values([ca, cb].map(clientId => ({ studioId, clientId, type: "consent" as const, url: "https://example.test/consent", createdById: owner }))).returning();
  await db.insert(s.consents).values(documents.map(document => ({ studioId, clientId: document.clientId, mediaId: document.id, consentType: "pmu_general" as const, signedAt: new Date() })));
  const [service] = await db.insert(s.services).values({ studioId, name: "Synthetic", category: "brows", procedureType: "brows", priceCents: 10000, durationMinutes: 60 }).returning();
  [appointmentA, appointmentB] = (await db.insert(s.appointments).values([ma, mb].map(masterId => ({ studioId, clientId: ca, masterId, serviceId: service.id,
    startAt: new Date("2026-10-01T10:00Z"), endAt: new Date("2026-10-01T11:00Z"), source: "other" as const, createdById: owner,
    serviceSnapshot: {}, clientSnapshot: {}, masterSnapshot: {}, priceSnapshotCents: 10000, durationSnapshotMinutes: 60 }))).returning()).map(r => r.id);
  const payments = await db.insert(s.payments).values([appointmentA, appointmentB, null].map(appointmentId => ({ studioId, clientId: ca, appointmentId, totalAmountCents: 10000, balanceAmountCents: 10000 }))).returning();
  paymentA = payments[0].id;
  await db.insert(s.paymentTransactions).values(payments.map(payment => ({ studioId, clientId: ca, paymentId: payment.id, appointmentId: payment.appointmentId, type: "deposit" as const, method: "cash" as const, amountCents: 1000, createdById: owner })));
});
beforeEach(async () => {
  session.id = a;
  await database.db.update(s.clients).set({ assignedMasterId: ma, deletedAt: null }).where(eq(s.clients.id, ca));
  await database.db.update(s.masters).set({ userId: a, isActive: true }).where(eq(s.masters.id, ma));
  await database.db.update(s.studioMembers).set({ roleId: roleIds.get("MASTER")!, isActive: true }).where(eq(s.studioMembers.userId, a));
  vi.mocked(uploadToCloudinary).mockReset().mockResolvedValue({ url: "https://example.test/file", publicId: "synthetic" });
  vi.mocked(deleteFromCloudinary).mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  if (!database) return;
  try { await database.db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
    await database.db.delete(s.studios).where(inArray(s.studios.id, [studioId, foreignStudio]));
    await database.db.delete(s.user).where(inArray(s.user.id, [owner, a, b, admin]));
  } finally { await database.close(); }
});
test("master sees only assigned clients in lists/search/direct/medical; global LTV is hidden", async () => {
  expect((await clients.getClients(studioId)).map(c => c.id)).toEqual([ca]);
  expect((await search.globalSearchAction(studioId, "Synthetic")).clients.map(c => c.id)).toEqual([ca]);
  expect((await search.searchClientsAction(studioId, "Synthetic")).map(c => c.id)).toEqual([ca]);
  expect(await clients.getClientById(cb, studioId)).toBeUndefined();
  expect(await clients.getClientById(unassigned, studioId)).toBeUndefined();
  expect(await clients.getClientMedicalProfile(cb, studioId)).toBeUndefined();
  expect((await clients.getClientMedicalProfile(ca, studioId))?.medicalNotes).toBe("Own medical");
  expect((await clients.getClientById(ca, studioId))?.ltvCents).toBeNull();
  expect(await clients.getClientActivity(cb, studioId)).toEqual([]);
  expect((await masters.getMasters(studioId)).map(m => m.id)).toEqual([ma]);
  expect(await masters.getMasterById(mb, studioId)).toBeUndefined();
});
test("unbound, inactive and foreign-studio access fail closed", async () => {
  await database.db.update(s.masters).set({ userId: null }).where(eq(s.masters.id, ma));
  expect(await clients.getClients(studioId)).toEqual([]);
  await expect(clients.getClients(foreignStudio)).rejects.toThrow("Permission denied");
  await database.db.update(s.masters).set({ userId: a, isActive: false }).where(eq(s.masters.id, ma));
  expect(await clients.getClients(studioId)).toEqual([]);
});
test("foreign client write and upload are rejected before provider I/O", async () => {
  await expect(actions.updateClientAction(cb, { firstName: "Tampered", phone: "+390000000000", clientStatus: "new_lead" })).rejects.toThrow("Client not found");
  await expect(media.mediaService.uploadMedia(new File(["test"], "test.txt"), { studioId, clientId: cb, type: "before", createdById: a })).rejects.toThrow("Client not found");
  expect(uploadToCloudinary).not.toHaveBeenCalled();
});
test("master cannot read another master's appointments/payments even for own client", async () => {
  expect((await calendar.getClientAppointments(ca, studioId)).map(r => r.id)).toEqual([appointmentA]);
  expect((await finance.getClientPayments(ca, studioId)).map(r => r.id)).toEqual([paymentA]);
  expect((await finance.getClientPaymentTransactions(ca, studioId)).map(r => r.paymentId)).toEqual([paymentA]);
  session.id = owner;
  expect(await finance.getClientPayments(ca, studioId)).toHaveLength(3);
});
test("Admin transfer is audited; old master loses access and stale decisions cannot overwrite it", async () => {
  session.id = admin;
  await management.assignClientMaster({ clientId: ca, masterId: mb, expectedMasterId: ma, reason: "Client requested transfer" });
  const history = await database.db.select().from(s.clientAssignments).where(eq(s.clientAssignments.clientId, ca));
  expect(history.some(h => h.previousMasterId === ma && h.masterId === mb && h.changedById === admin)).toBe(true);
  const audit = await database.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, ca));
  expect(audit.some(e => e.action === "client_master_assigned")).toBe(true);
  await expect(management.assignClientMaster({ clientId: ca, masterId: null, expectedMasterId: ma, reason: "Stale selection" })).rejects.toThrow("уже изменилось");
  session.id = a; expect(await clients.getClientById(ca, studioId)).toBeUndefined();
  session.id = b; expect((await clients.getClientById(ca, studioId))?.id).toBe(ca);
});
test("Master cannot assign; cross-studio assignments and duplicate bindings fail", async () => {
  await expect(management.assignClientMaster({ clientId: ca, masterId: ma, expectedMasterId: ma, reason: "Self assignment" })).rejects.toThrow("Permission denied");
  session.id = owner;
  await expect(management.assignClientMaster({ clientId: ca, masterId: foreignMaster, expectedMasterId: ma, reason: "Foreign master" })).rejects.toThrow("Master not found");
  await expect(database.db.update(s.clients).set({ assignedMasterId: foreignMaster }).where(eq(s.clients.id, ca))).rejects.toThrow();
  await expect(database.db.update(s.masters).set({ userId: a }).where(eq(s.masters.id, mb))).rejects.toThrow();
});
test("reassignment during provider upload cancels persistence and compensates file", async () => {
  vi.mocked(uploadToCloudinary).mockImplementationOnce(async () => {
    session.id = owner;
    await management.assignClientMaster({ clientId: ca, masterId: mb, expectedMasterId: ma, reason: "Concurrent transfer" });
    session.id = a;
    return { url: "https://example.test/file", publicId: "synthetic" };
  });
  await expect(media.mediaService.uploadMedia(new File(["test"], "test.txt"), { studioId, clientId: ca, type: "before", createdById: a })).rejects.toThrow("Client not found");
  expect(deleteFromCloudinary).toHaveBeenCalledWith("synthetic");
});
test("only Owner changes membership; last Owner and occupied master binding are protected", async () => {
  const input = { email: `${a}@example.test`, role: "MASTER" as const, active: true, masterId: ma, reason: "Link account" };
  await expect(management.saveMembership(input)).rejects.toThrow("Permission denied");
  session.id = owner;
  await expect(management.saveMembership({ ...input, email: `${owner}@example.test`, role: "ADMIN", masterId: null })).rejects.toThrow("последнего владельца");
  await expect(management.saveMembership({ ...input, masterId: mb })).rejects.toThrow("уже привязан");
  await management.saveMembership({ ...input, active: false, masterId: null });
  session.id = a; await expect(clients.getClients(studioId)).rejects.toThrow("Permission denied");
});
test("audit failure rolls back assignment history and client update", async () => {
  session.id = owner;
  const name = `fail_scope_${randomUUID().replaceAll("-", "")}`;
  await database.db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'client_master_assigned' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`));
  const before = await database.db.select().from(s.clientAssignments).where(eq(s.clientAssignments.clientId, ca));
  try {
    await database.db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    await expect(management.assignClientMaster({ clientId: ca, masterId: mb, expectedMasterId: ma, reason: "Rollback proof" })).rejects.toThrow();
    expect((await database.db.select().from(s.clients).where(eq(s.clients.id, ca)))[0].assignedMasterId).toBe(ma);
    expect(await database.db.select().from(s.clientAssignments).where(eq(s.clientAssignments.clientId, ca))).toEqual(before);
  } finally {
    await database.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`));
    await database.db.execute(sql.raw(`DROP FUNCTION ${name}()`));
  }
});

test("medical writes require assignment and remain available to the assigned master", async () => {
  const input = { previousPMU: false, herpesHistory: false, diabetes: false, bloodThinners: false,
    keloidRisk: false, autoimmuneDiseases: false, recentBotoxFillers: false, recentPeelingLaser: false, skinSensitivity: false };
  await expect(medical.upsertMedicalProfileAction(cb, input)).rejects.toThrow("Client not found");
  await medical.upsertMedicalProfileAction(ca, { ...input, medicalNotes: "Own updated" });
  expect((await clients.getClientMedicalProfile(ca, studioId))?.medicalNotes).toBe("Own updated");
});

test("media and consent retrieval do not expose another assigned client's file URLs", async () => {
  const { consentService } = await import("@/features/consent/server/service");
  expect((await media.mediaService.getClientMedia(ca, studioId)).map(r => r.id)).toEqual([mediaA]);
  expect(await media.mediaService.getClientMedia(cb, studioId)).toEqual([]);
  expect((await media.mediaService.getMediaById(mediaA, studioId))?.id).toBe(mediaA);
  expect(await media.mediaService.getMediaById(mediaB, studioId)).toBeUndefined();
  expect(await consentService.getClientConsents(ca, studioId)).toHaveLength(1);
  expect(await consentService.getClientConsents(cb, studioId)).toEqual([]);
});

test("studio-wide mutations remain Owner-only and use the same transaction boundary", async () => {
  const services = await import("@/features/services/server/actions");
  const settings = await import("@/features/settings/server/actions");
  const [service] = await database.db.select().from(s.services).where(eq(s.services.studioId, studioId));
  const [studio] = await database.db.select().from(s.studios).where(eq(s.studios.id, studioId));
  const input = { name: "Updated catalog", category: "brows" as const, procedureType: "brows" as const, price: 123,
    durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, requiresCorrection: false, isActive: true };
  await expect(services.updateServiceAction(service.id, input)).rejects.toThrow("Permission denied");
  await expect(settings.updateStudioSettingsAction({ name: "Forbidden", slug: studio.slug, timezone: studio.timezone })).rejects.toThrow("Permission denied");
  session.id = owner;
  await services.updateServiceAction(service.id, input);
  expect((await database.db.select().from(s.services).where(eq(s.services.id, service.id)))[0].priceCents).toBe(12300);
  await settings.updateStudioSettingsAction({ name: "Updated studio", slug: studio.slug, timezone: studio.timezone });
  expect((await database.db.select().from(s.studios).where(eq(s.studios.id, studioId)))[0].name).toBe("Updated studio");
  const logs = await database.db.select().from(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
  expect(logs.some(e => e.action === "studio_settings_updated")).toBe(true);
  expect(logs.some(e => e.action === "service_updated")).toBe(true);
});
