import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql, getTableName } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { MERGE_FIELDS, type MergeInput, type MergeField } from "@/features/clients/merge-contract";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() })); vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let actions: typeof import("@/features/clients/server/merge-actions"), queries: typeof import("@/features/clients/server/queries"), mutations: typeof import("@/features/clients/server/actions");
let studioId: string, foreignStudio: string, source: typeof s.clients.$inferSelect, target: typeof source, roleIds: Record<string, string>;
const actor = randomUUID();
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  actions = await import("@/features/clients/server/merge-actions"); queries = await import("@/features/clients/server/queries"); mutations = await import("@/features/clients/server/actions");
  await db.insert(s.user).values({ id: actor, name: "Synthetic", email: `${actor}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map(row => [row.code, row.id]));
});
beforeEach(async () => {
  session.id = actor;
  [studioId, foreignStudio] = (await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()).map(row => row.id);
  await db.insert(s.studioMembers).values({ studioId, userId: actor, roleId: roleIds.OWNER });
  [source, target] = await db.insert(s.clients).values([{ ...clientFixture(studioId), firstName: "Source", fullName: "Source", notes: "Source note", phone: "+393331111111", ltvCents: 100, visitCount: 2 }, { ...clientFixture(studioId), firstName: "Target", fullName: "Target", notes: "Target note", phone: "+393332222222", ltvCents: 200, visitCount: 3 }]).returning();
});
afterEach(async () => { await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.studios).where(eq(s.studios.id, foreignStudio)); });
afterAll(async () => { try { await db.delete(s.user).where(eq(s.user.id, actor)); } finally { await database.close(); } });
async function input(sourceId = source.id, targetId = target.id): Promise<MergeInput> {
  const preview = await actions.previewClientMerge({ sourceId, targetId });
  return { sourceId, targetId, token: preview.token, reason: "Confirmed same person", choices: Object.fromEntries((Object.keys(MERGE_FIELDS) as MergeField[]).map(field => [field, "target" as const])) };
}
const client = async (id: string) => (await db.select().from(s.clients).where(eq(s.clients.id, id)))[0];
async function rich() {
  const [master] = await db.insert(s.masters).values({ studioId, displayName: "Master" }).returning();
  const [service] = await db.insert(s.services).values({ studioId, name: "Legacy brows", category: "brows", procedureType: "brows" }).returning();
  const common = { studioId, clientId: source.id };
  const [appointment] = await db.insert(s.appointments).values({ ...common, masterId: master.id, serviceId: service.id, startAt: new Date("2026-01-01T10:00:00Z"), endAt: new Date("2026-01-01T11:00:00Z"), source: "phone", createdById: actor, serviceSnapshot: { historic: true }, clientSnapshot: { name: "Original booking" }, masterSnapshot: {}, priceSnapshotCents: 10000, durationSnapshotMinutes: 60 }).returning();
  const [procedure] = await db.insert(s.procedureSessions).values({ ...common, appointmentId: appointment.id, masterId: master.id, serviceId: service.id, procedureArea: "brows", procedureType: "brows", sessionType: "primary_session" }).returning();
  const linked = { ...common, appointmentId: appointment.id, procedureSessionId: procedure.id };
  const [media] = await db.insert(s.media).values({ ...linked, type: "consent", url: "https://example.test/private-document", publicId: "retained", createdById: actor, deletedAt: new Date() }).returning();
  const [consent] = await db.insert(s.consents).values({ ...common, procedureSessionId: procedure.id, mediaId: media.id, consentType: "brows", signedAt: new Date() }).returning();
  const [payment] = await db.insert(s.payments).values({ ...linked, totalAmountCents: 10000, paidAmountCents: 5000, balanceAmountCents: 5000 }).returning();
  const [transaction] = await db.insert(s.paymentTransactions).values({ ...linked, paymentId: payment.id, type: "deposit", method: "cash", amountCents: 5000, createdById: actor }).returning();
  const [task] = await db.insert(s.tasks).values({ ...linked, assignedToId: actor, title: "Retain task", type: "custom" }).returning();
  await db.insert(s.notifications).values({ ...common, userId: actor, type: s.notificationTypeEnum.enumValues[0], title: "Original", message: "Original", taskId: task.id });
  await db.insert(s.activityEvents).values({ ...linked, type: "client_created", title: "Historic", metadata: { originalClientId: source.id } });
  await db.insert(s.clientAssignments).values({ ...common, masterId: master.id, changedById: actor, reason: "Original assignment" });
  await db.insert(s.clientStatusHistory).values({ ...common, newStatus: "new_lead", changedById: actor });
  const [template] = await db.insert(s.questionnaireTemplates).values({ studioId, name: "Synthetic", procedureArea: "brows", sessionType: "primary_session", questions: [] }).returning();
  await db.insert(s.questionnaireResponses).values({ ...linked, templateId: template.id, answers: { original: true } });
  await db.insert(s.reviews).values({ ...linked, rating: 5, source: s.reviewSourceEnum.enumValues[0] });
  const [offer] = await db.insert(s.customOffers).values(common).returning();
  await db.insert(s.clientDuplicateDecisions).values([source,target].map(row => ({ studioId, clientId: row.id, actorId: actor, reason: "Prior decision", reviewToken: "a".repeat(64), matches: [] })));
  await db.insert(s.clientMedicalProfiles).values([{ clientId: source.id, allergies: "Source allergy", diabetes: true }, { clientId: target.id, allergies: "Target allergy" }]);
  return { appointment, procedure, media, consent, payment, transaction, offer };
}
test("every direct client FK is classified in the merge registry", async () => {
  const registry = await import("@/features/clients/server/merge-registry");
  const actual = (Object.values(s) as unknown[]).filter((value): value is PgTable => value instanceof PgTable).filter(table => getTableConfig(table).foreignKeys.some(fk => fk.reference().foreignTable === s.clients)).map(getTableName).sort();
  expect(actual).toEqual([...registry.MOVABLE_CLIENT_TABLES, ...registry.SPECIAL_CLIENT_TABLES].sort());
});
test("rich merge retains all relations, financial amounts, document IDs, medical evidence and field provenance", async () => {
  const old = await rich(), data = await input(); data.choices.notes = "source";
  const result = await actions.mergeClientsAction(data, randomUUID()); expect(result.kind).toBe("merged");
  expect(await client(target.id)).toMatchObject({ notes: "Source note", ltvCents: 300, visitCount: 5 });
  expect(await client(source.id)).toMatchObject({ mergedIntoId: target.id, phone: source.phone, notes: source.notes });
  for (const [table, before] of [[s.appointments,old.appointment],[s.procedureSessions,old.procedure],[s.media,old.media],[s.consents,old.consent],[s.payments,old.payment],[s.paymentTransactions,old.transaction],[s.customOffers,old.offer]] as const) {
    expect((await db.select().from(table).where(eq(table.id,before.id)))[0]).toEqual({ ...before, clientId: target.id });
  }
  const [record] = await db.select().from(s.clientMerges).where(eq(s.clientMerges.sourceId, source.id));
  expect(record.provenance.notes).toBe(source.id); expect(record.sourceSnapshot).toMatchObject({ notes: source.notes });
  expect(Object.values(record.movedRecords).every(ids => ids.length > 0)).toBe(true);
  expect(await db.select().from(s.clientDuplicateDecisions).where(eq(s.clientDuplicateDecisions.clientId, target.id))).toHaveLength(2);
  expect(await queries.getClientMedicalProfile(target.id, studioId)).toMatchObject({ allergies: "Target allergy", mergeReviewRequired: true });
  expect((await db.query.clients.findFirst({ where: eq(s.clients.id,target.id), with: { medicalProfiles: true } }))?.medicalProfiles).toHaveLength(2);
  expect(await queries.getClientMedicalHistory(source.id, studioId)).toMatchObject([{ allergies: "Source allergy", diabetes: true, clientId: target.id }]);
  await expect(db.update(s.clientMerges).set({ reason: "Rewrite" }).where(eq(s.clientMerges.id,record.id))).rejects.toThrow();
  await expect(db.update(s.customOffers).set({ clientId: source.id }).where(eq(s.customOffers.id,old.offer.id))).rejects.toThrow();
});
test("old IDs resolve reads, archived aliases cannot be edited or restored", async () => {
  await actions.mergeClientsAction(await input(), randomUUID());
  expect((await queries.getClientById(source.id, studioId))?.id).toBe(target.id);
  expect(await queries.getClients(studioId)).toHaveLength(1);
  await expect(mutations.restoreClientAction(source.id)).rejects.toThrow();
  await expect(mutations.updateClientAction(source.id, { firstName: "Stale", phone: source.phone, clientStatus: "new_lead" })).rejects.toThrow();
});
test("same key retry is one merge; conflicting payload under same key is rejected", async () => {
  const data = await input(), key = randomUUID();
  const results = await Promise.all([actions.mergeClientsAction(data,key), actions.mergeClientsAction(data,key)]);
  expect(results[0]).toEqual(results[1]); expect(await db.select().from(s.clientMerges).where(eq(s.clientMerges.studioId,studioId))).toHaveLength(1);
  await expect(actions.mergeClientsAction({ ...data, reason: "Changed reason" },key)).rejects.toThrow();
});
test("concurrent different merges cannot consume the same source twice", async () => {
  const [third] = await db.insert(s.clients).values(clientFixture(studioId)).returning();
  const first = await input(), second = await input(source.id, third.id);
  const outcomes = await Promise.allSettled([actions.mergeClientsAction(first,randomUUID()), actions.mergeClientsAction(second,randomUUID())]);
  expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(s.clientMerges).where(eq(s.clientMerges.studioId,studioId))).toHaveLength(1);
});
test("changed client or related record invalidates preview; blank reason/missing conflict choice rejected", async () => {
  const data = await input(); await db.update(s.clients).set({ notes: "Changed" }).where(eq(s.clients.id,source.id));
  expect(await actions.mergeClientsAction(data, randomUUID())).toEqual({ kind: "stale" });
  const fresh = await input(); await db.insert(s.activityEvents).values({ studioId, clientId: source.id, type: "client_updated", title: "New relation" });
  expect(await actions.mergeClientsAction(fresh, randomUUID())).toEqual({ kind: "stale" });
  await expect(actions.mergeClientsAction({ ...await input(), reason: " " }, randomUUID())).rejects.toThrow();
  await expect(actions.mergeClientsAction({ ...await input(), choices: {} }, randomUUID())).rejects.toThrow();
  expect((await client(source.id)).mergedIntoId).toBeNull();
});
test("cross-studio, self merge, archived target and unauthorized roles are rejected", async () => {
  const [foreign] = await db.insert(s.clients).values(clientFixture(foreignStudio)).returning();
  await expect(input(source.id,foreign.id)).rejects.toThrow(); await expect(input(source.id,source.id)).rejects.toThrow();
  await db.update(s.clients).set({ deletedAt: new Date() }).where(eq(s.clients.id,target.id)); await expect(input()).rejects.toThrow();
  await db.update(s.clients).set({ deletedAt: null }).where(eq(s.clients.id,target.id));
  const data = await input();
  for (const role of ["MASTER","AI_SYSTEM"]) {
    await db.update(s.studioMembers).set({ roleId: roleIds[role] }).where(eq(s.studioMembers.studioId,studioId));
    await expect(input()).rejects.toThrow(); await expect(actions.mergeClientsAction(data,randomUUID())).rejects.toThrow();
  }
});
test("Admin can merge, explicit archive deny blocks; resolved ID retains current Master scope", async () => {
  await db.update(s.studioMembers).set({ roleId: roleIds.ADMIN }).where(eq(s.studioMembers.studioId,studioId));
  const [permission] = await db.select().from(s.permissions).where(eq(s.permissions.code,"CLIENT_ARCHIVE"));
  await db.insert(s.userCustomPermissions).values({ studioId,userId:actor,permissionId:permission.id,effect:"deny" }); await expect(input()).rejects.toThrow();
  await db.delete(s.userCustomPermissions).where(eq(s.userCustomPermissions.studioId,studioId));
  await actions.mergeClientsAction(await input(),randomUUID());
  await db.update(s.studioMembers).set({ roleId: roleIds.MASTER }).where(eq(s.studioMembers.studioId,studioId));
  expect(await queries.getClientById(source.id,studioId)).toBeUndefined();
  const [master] = await db.insert(s.masters).values({ studioId,userId:actor,displayName:"Own master" }).returning();
  await db.update(s.clients).set({ assignedMasterId:master.id }).where(eq(s.clients.id,target.id));
  expect((await queries.getClientById(source.id,studioId))?.id).toBe(target.id);
});
test("chain flattening retains both merge records and original create retry returns a resolvable ID", async () => {
  const created = await mutations.createClientAction({firstName:"Retry",phone:"+393339999999",clientStatus:"new_lead"}, "11111111-1111-4111-8111-111111111111");
  await actions.mergeClientsAction(await input(created.id,source.id),randomUUID()); await actions.mergeClientsAction(await input(),randomUUID());
  expect((await client(created.id)).mergedIntoId).toBe(target.id); expect(await actions.getClientMergeHistory(target.id)).toHaveLength(2);
  expect(await mutations.createClientAction({firstName:"Retry",phone:"+393339999999",clientStatus:"new_lead"},"11111111-1111-4111-8111-111111111111")).toEqual(created);
  expect((await queries.getClientById(created.id,studioId))?.id).toBe(target.id);
});
test("audit failure rolls back moved rows, alias, snapshots and receipt", async () => {
  const old = await rich(), data = await input();
  const audit = await import("@/server/services/audit-log.service"); const spy = vi.spyOn(audit,"writeAudit").mockRejectedValueOnce(new Error("Audit unavailable"));
  try { await expect(actions.mergeClientsAction(data,randomUUID())).rejects.toThrow("Audit unavailable"); } finally { spy.mockRestore(); }
  expect(await client(source.id)).toEqual(source); expect(await client(target.id)).toEqual(target);
  expect((await db.select().from(s.payments).where(eq(s.payments.id,old.payment.id)))[0]).toEqual(old.payment);
  expect(await db.select().from(s.clientMerges).where(eq(s.clientMerges.studioId,studioId))).toHaveLength(0);
  expect(await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId,studioId))).toHaveLength(0);
});
test("cross-studio corrupt legacy relation blocks merge rather than transferring foreign data", async () => {
  await db.insert(s.tasks).values({studioId:foreignStudio,clientId:source.id,assignedToId:actor,title:"Corrupt legacy",type:"custom"});
  await expect(input()).rejects.toThrow("Несогласованная");
});
test("historical contacts still identify the canonical client after merge", async () => {
  await actions.mergeClientsAction(await input(),randomUUID()); const { reviewClientDuplicates } = await import("@/features/clients/server/duplicate-actions");
  const result = await reviewClientDuplicates({firstName:"New name",phone:source.phone,clientStatus:"new_lead"});
  expect(result.candidates.map(row => row.id)).toEqual([target.id]);
});
test("medical acknowledgement requires a specialist and preserves historical profiles", async () => {
  await rich(); await actions.mergeClientsAction(await input(), randomUUID());
  const medical = await import("@/features/medical/server/actions");
  const version = (await queries.getClientMedicalProfile(target.id,studioId))!.updatedAt.toISOString();
  await db.update(s.studioMembers).set({roleId:roleIds.ADMIN}).where(eq(s.studioMembers.studioId,studioId));
  await expect(medical.acknowledgeMedicalMergeReview(target.id,"Reviewed source history",version)).rejects.toThrow();
  await db.update(s.studioMembers).set({roleId:roleIds.OWNER}).where(eq(s.studioMembers.studioId,studioId));
  await medical.acknowledgeMedicalMergeReview(target.id,"Reviewed source history",version);
  expect(await queries.getClientMedicalProfile(target.id,studioId)).toMatchObject({mergeReviewRequired:false,allergies:"Target allergy"});
  expect(await queries.getClientMedicalHistory(target.id,studioId)).toHaveLength(1);
});
test("merge preview fails closed when access logging fails", async () => {
  await db.execute(sql`alter table access_logs add constraint reject_merge_reads check (operation != 'clients.merge.preview')`);
  try { await expect(input()).rejects.toThrow("Access logging unavailable"); } finally {await db.execute(sql`alter table access_logs drop constraint reject_merge_reads`);}
});
test("archived source may merge into an active target; stale medical review cannot clear a new warning", async () => {
  await rich(); await db.update(s.clients).set({deletedAt:new Date()}).where(eq(s.clients.id,source.id));
  expect((await actions.getMergeCandidates(target.id)).find(row=>row.id===source.id)?.archivedAt).not.toBeNull();
  await actions.mergeClientsAction(await input(),randomUUID());
  const old = (await queries.getClientMedicalProfile(target.id,studioId))!;
  await db.update(s.clientMedicalProfiles).set({updatedAt:new Date(old.updatedAt.getTime()+1000)}).where(eq(s.clientMedicalProfiles.id,old.id));
  const { acknowledgeMedicalMergeReview } = await import("@/features/medical/server/actions");
  await expect(acknowledgeMedicalMergeReview(target.id,"Read older version",old.updatedAt.toISOString())).rejects.toThrow("изменились");
  expect((await queries.getClientMedicalProfile(target.id,studioId))?.mergeReviewRequired).toBe(true);
});
