import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { cycleDraftSchema } from "@/features/treatment-cycles/schemas/cycle.schema";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let report: typeof import("@/features/treatment-cycles/server/queries");
let studioId: string, otherStudio: string, clientId: string, otherClient: string, foreignClient: string, masterId: string, serviceId: string;
let roles: Record<string,string>;
const actor = randomUUID();
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db })); db = (await import("@/db")).db;
  report = await import("@/features/treatment-cycles/server/queries");
  await db.insert(s.user).values({ id: actor, name: "Synthetic", email: `${actor}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  roles = Object.fromEntries((await db.select().from(s.roles)).map(row=>[row.code,row.id]));
});
beforeEach(async () => {
  session.id = actor;
  [studioId,otherStudio] = (await db.insert(s.studios).values([studioFixture(),studioFixture()]).returning()).map(row=>row.id);
  await db.insert(s.studioMembers).values({studioId,userId:actor,roleId:roles.OWNER});
  [clientId,otherClient] = (await db.insert(s.clients).values([clientFixture(studioId),clientFixture(studioId)]).returning()).map(row=>row.id);
  [foreignClient] = (await db.insert(s.clients).values(clientFixture(otherStudio)).returning()).map(row=>row.id);
  [masterId] = (await db.insert(s.masters).values({studioId,displayName:"Synthetic"}).returning()).map(row=>row.id);
  [serviceId] = (await db.insert(s.services).values({studioId,name:"Legacy",category:"brows",procedureType:"brows"}).returning()).map(row=>row.id);
});
afterEach(async () => { await db.delete(s.studios).where(eq(s.studios.id,studioId)); await db.delete(s.studios).where(eq(s.studios.id,otherStudio)); });
afterAll(async () => { try {await db.delete(s.user).where(eq(s.user.id,actor));} finally {await database.close();} });
async function cycle(extra: Partial<typeof s.treatmentCycles.$inferInsert> = {}) {
  return (await db.insert(s.treatmentCycles).values({studioId,clientId,zoneCode:"brows",kind:"pmu",...extra}).returning())[0];
}
async function visit() {
  return (await db.insert(s.appointments).values({studioId,clientId,masterId,serviceId,startAt:new Date("2026-01-01T10:00:00Z"),endAt:new Date("2026-01-01T11:00:00Z"),source:"phone",createdById:actor,serviceSnapshot:{legacy:true},clientSnapshot:{},masterSnapshot:{},priceSnapshotCents:100,durationSnapshotMinutes:60}).returning())[0];
}
function link(appointmentId:string,cycleId:string, extra: Partial<typeof s.appointmentCycles.$inferInsert> = {}) {
  return db.insert(s.appointmentCycles).values({studioId,clientId,appointmentId,cycleId,visitKind:"session_1",serviceSnapshot:{name:"Historical"},...extra});
}
test("draft excludes multiple zones, protected fields and missing origins", () => {
  const draft = {clientId,zoneCode:"brows",kind:"pmu"};
  expect(cycleDraftSchema.safeParse(draft).success).toBe(true);
  for (const extra of [{zoneCode:"cycle_zone"},{zoneCode:["brows","eyes"]},{stage:"cycle_completed"},{price:100},{kind:"refresh"},{kind:"pmu",zoneCode:"skin"},{kind:"remover",packageId:randomUUID()}]) expect(cycleDraftSchema.safeParse({...draft,...extra}).success).toBe(false);
});
test("independent zones and repeated courses retain independent clocks and versions", async () => {
  const first = await cycle({firstSessionAt:new Date("2026-01-01T10:00:00Z"),version:2});
  const eyes = await cycle({zoneCode:"eyes"}), repeated = await cycle();
  expect(eyes).toMatchObject({stage:"new_lead",version:1,firstSessionAt:null});
  expect(repeated.id).not.toBe(first.id);
  expect((await db.select().from(s.clients).where(eq(s.clients.id,clientId)))[0].clientStatus).toBe("new_lead");
});
test("database enforces single real zone, valid version, stage and ordered session dates", async () => {
  for (const extra of [{zoneCode:"cycle_zone"},{kind:"pmu",zoneCode:"skin"},{version:0},{stage:"invented"},{kind:"refresh"},{suspendedAt:new Date()},{secondSessionAt:new Date()},{firstSessionAt:new Date("2026-02-01"),secondSessionAt:new Date("2026-01-01")}]) await expect(cycle(extra)).rejects.toThrow();
});
test("Total Face shell permits three unique PMU zones and rejects cross-client or non-PMU members", async () => {
  const [pkg] = await db.insert(s.treatmentPackages).values({studioId,clientId}).returning();
  for (const zoneCode of ["brows","eyes","lips"]) await cycle({packageId:pkg.id,zoneCode});
  await expect(cycle({packageId:pkg.id})).rejects.toThrow();
  await expect(cycle({packageId:pkg.id,clientId:otherClient})).rejects.toThrow();
  await expect(cycle({packageId:pkg.id,kind:"non_pmu",zoneCode:"skin"})).rejects.toThrow();
});
test("origin graph retains the PMU course and rejects loops and foreign person/zone", async () => {
  const base = await cycle(); const refresh = await cycle({kind:"refresh",originCycleId:base.id});
  expect(refresh.originCycleId).toBe(base.id);
  await cycle({kind:"remover",originCycleId:base.id});
  await expect(cycle({kind:"refresh",originCycleId:base.id,clientId:otherClient})).rejects.toThrow();
  await expect(cycle({kind:"refresh",originCycleId:base.id,zoneCode:"eyes"})).rejects.toThrow();
  await expect(db.update(s.treatmentCycles).set({originCycleId:refresh.id}).where(eq(s.treatmentCycles.id,base.id))).rejects.toThrow();
  await expect(db.update(s.treatmentCycles).set({kind:"remover"}).where(eq(s.treatmentCycles.id,base.id))).rejects.toThrow();
});
test("cycle references cannot cross a studio boundary or guess legacy service mapping", async () => {
  await expect(cycle({clientId:foreignClient})).rejects.toThrow();
  const [master] = await db.insert(s.masters).values({studioId:otherStudio,displayName:"Foreign"}).returning();
  await expect(cycle({assignedMasterId:master.id})).rejects.toThrow();
  await expect(cycle({serviceId})).rejects.toThrow();
  const definitions = await db.select().from(s.serviceDefinitions);
  const definition = definitions.find(row=>row.zoneCode==="brows" && row.categoryCode==="pmu")!;
  await db.update(s.services).set({catalogCode:definition.code}).where(eq(s.services.id,serviceId));
  expect((await cycle({serviceId})).serviceId).toBe(serviceId);
  await expect(cycle({serviceId,zoneCode:"eyes"})).rejects.toThrow();
  await expect(cycle({serviceId,kind:"remover"})).rejects.toThrow();
});
test("one visit serves multiple cycles with snapshots and rejects duplicate or foreign-client links", async () => {
  const appointment = await visit(), brows = await cycle(), eyes = await cycle({zoneCode:"eyes"});
  await link(appointment.id,brows.id); await link(appointment.id,eyes.id);
  await expect(link(appointment.id,brows.id)).rejects.toThrow();
  const other = await cycle({clientId:otherClient});
  await expect(link(appointment.id,other.id)).rejects.toThrow();
  await expect(link(appointment.id,other.id,{clientId:otherClient})).rejects.toThrow();
  expect(await db.select().from(s.appointmentCycles).where(eq(s.appointmentCycles.appointmentId,appointment.id))).toHaveLength(2);
});
test("procedure requires matching cycle/visit/zone and reverse zone edits cannot invalidate history", async () => {
  const appointment = await visit(), brows = await cycle();
  const values = {studioId,clientId,appointmentId:appointment.id,cycleId:brows.id,masterId,serviceId,procedureArea:"brows" as const,procedureType:"brows" as const,sessionType:"primary_session" as const};
  await expect(db.insert(s.procedureSessions).values(values)).rejects.toThrow();
  await link(appointment.id,brows.id);
  await expect(db.insert(s.procedureSessions).values({...values,procedureArea:"lips"})).rejects.toThrow();
  await db.insert(s.procedureSessions).values(values);
  await expect(db.update(s.treatmentCycles).set({zoneCode:"eyes"}).where(eq(s.treatmentCycles.id,brows.id))).rejects.toThrow();
});
test("legacy report is diagnostic, excludes linked visits, and never converts historical rows", async () => {
  const appointment = await visit();
  const [procedure] = await db.insert(s.procedureSessions).values({studioId,clientId,appointmentId:appointment.id,masterId,serviceId,procedureArea:"total_look",procedureType:"brows",sessionType:"primary_session"}).returning();
  const result = await report.getLegacyCycleReport();
  expect(result).toMatchObject({automaticConversions:0,truncated:false});
  expect(result.entries).toHaveLength(2);
  expect(result.entries.find(row=>row.id===procedure.id)?.reasons).toContain("ambiguous_procedure_zone");
  expect(result.entries.every(row=>row.reasons.includes("catalog_mapping_required"))).toBe(true);
  expect(await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId,studioId))).toHaveLength(0);
  expect((await db.select().from(s.procedureSessions).where(eq(s.procedureSessions.id,procedure.id)))[0]).toEqual(procedure);
  const brows = await cycle(); await link(appointment.id,brows.id);
  expect((await report.getLegacyCycleReport()).entries.map(row=>row.id)).toEqual([procedure.id]);
});
test("legacy report rejects unauthorized roles and fails closed when access logging fails", async () => {
  for (const role of ["ADMIN","MASTER","AI_SYSTEM"]) {
    await db.update(s.studioMembers).set({roleId:roles[role]}).where(eq(s.studioMembers.studioId,studioId));
    await expect(report.getLegacyCycleReport()).rejects.toThrow();
  }
  await db.update(s.studioMembers).set({roleId:roles.OWNER}).where(eq(s.studioMembers.studioId,studioId));
  await db.execute(sql`alter table access_logs add constraint reject_cycle_reads check (operation != 'cycles.legacy.report') NOT VALID`);
  try {await expect(report.getLegacyCycleReport()).rejects.toThrow("Access logging unavailable");} finally {await db.execute(sql`alter table access_logs drop constraint reject_cycle_reads`);}
});
