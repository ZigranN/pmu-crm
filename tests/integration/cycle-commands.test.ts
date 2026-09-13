import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { CYCLE_STAGES } from "@/features/treatment-cycles/schemas/cycle.schema";
import { TRANSITIONS, REQUIRED_COMMAND, type CycleStage } from "@/features/treatment-cycles/stages";
import { transitionBlock } from "@/features/treatment-cycles/server/transitions";
const session=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:async()=>({user:{id:session.id}})}}}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
let database:Awaited<ReturnType<typeof createTestDatabase>>,db:typeof import("@/db").db;
let commands:typeof import("@/features/treatment-cycles/server/actions"),queries:typeof import("@/features/treatment-cycles/server/queries");
let studioId:string,foreignStudio:string,clientId:string,masterId:string,otherMaster:string,roles:Record<string,string>;
const actor=randomUUID();
beforeAll(async()=>{
  database=await createTestDatabase();vi.doMock("@/db",()=>({db:database.db}));db=(await import("@/db")).db;
  commands=await import("@/features/treatment-cycles/server/actions");queries=await import("@/features/treatment-cycles/server/queries");
  await db.insert(s.user).values({id:actor,name:"Synthetic",email:`${actor}@example.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date()});
  roles=Object.fromEntries((await db.select().from(s.roles)).map(r=>[r.code,r.id]));
});
beforeEach(async()=>{
  session.id=actor;[studioId,foreignStudio]=(await db.insert(s.studios).values([studioFixture(),studioFixture()]).returning()).map(r=>r.id);
  await db.insert(s.studioMembers).values({studioId,userId:actor,roleId:roles.OWNER});
  [masterId,otherMaster]=(await db.insert(s.masters).values([{studioId,userId:actor,displayName:"Own"},{studioId,displayName:"Other"}]).returning()).map(r=>r.id);
  [clientId]=(await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:masterId,language:"it",clientKind:"new",reportedPreviousPmu:false,interestedZones:["brows","eyes","lips"]}).returning()).map(r=>r.id);
});
afterEach(async()=>{await db.delete(s.studios).where(eq(s.studios.id,studioId));await db.delete(s.studios).where(eq(s.studios.id,foreignStudio));});
afterAll(async()=>{try{await db.delete(s.user).where(eq(s.user.id,actor));}finally{await database.close();}});
const create=(zoneCode:"brows"|"eyes"|"lips"="brows",key=randomUUID())=>commands.createCycleAction({clientId,zoneCode,reason:"Client requested course"},key);
const move=(id:string,expectedVersion:number,to:CycleStage,key=randomUUID())=>commands.transitionCycleAction({id,expectedVersion,to,reason:"Human reviewed next action"},key);
const row=async(id:string)=>(await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,id)))[0];
async function counts(){return Promise.all([s.cycleStageHistory,s.auditLogs,s.outboxJobs,s.commandReceipts].map(table=>db.select({id:table.id}).from(table).where(eq(table.studioId,studioId)).then(rows=>rows.length)));}
test("matrix covers all 21 stages: every non-edge and every domain-owned target is blocked",async()=>{
  const cycle=await row((await create()).id),[client]=await db.select().from(s.clients).where(eq(s.clients.id,clientId));
  expect(Object.keys(TRANSITIONS)).toHaveLength(21);
  for(const from of CYCLE_STAGES) for(const to of CYCLE_STAGES){
    const block=transitionBlock({...cycle,stage:from},to,client);
    if(!TRANSITIONS[from].includes(to)||REQUIRED_COMMAND[to]) expect(block).not.toBeNull();
  }
  expect(transitionBlock(cycle,"qualification",client)).toBeNull();
});
test("create and three early transitions atomically retain history, receipt, event and audit",async()=>{
  const created=await create(),eyes=await create("eyes");
  await move(created.id,1,"qualification");await move(created.id,2,"consultation_needed");await move(created.id,3,"consultation_offered");
  expect(await row(created.id)).toMatchObject({stage:"consultation_offered",version:4});expect(await row(eyes.id)).toMatchObject({stage:"new_lead",version:1});
  expect(await counts()).toEqual([5,5,5,5]);
  const timeline=await queries.getCycleTimeline(created.id);expect(timeline.history.map(r=>r.version)).toEqual([4,3,2,1]);
  expect(timeline.choices.find(r=>r.to==="consultation_scheduled")?.blocked).toContain("календарь");
  expect((await db.select().from(s.clients).where(eq(s.clients.id,clientId)))[0].clientStatus).toBe("new_lead");
});
test("same-key concurrent retry creates one cycle and later replays historical transition without reverting state",async()=>{
  const key=randomUUID(),results=await Promise.all([create("brows",key),create("brows",key)]);expect(results[0]).toEqual(results[1]);
  const id=results[0].id,transitionKey=randomUUID();const first=await move(id,1,"qualification",transitionKey);await move(id,2,"consultation_needed");
  expect(await move(id,1,"qualification",transitionKey)).toEqual(first);expect((await row(id)).version).toBe(3);expect(await counts()).toEqual([3,3,3,3]);
  await expect(move(id,1,"lost",transitionKey)).rejects.toThrow("другими данными");
});
test("different commands with the same expected version cannot both commit",async()=>{
  const {id}=await create();const results=await Promise.allSettled([move(id,1,"qualification"),move(id,1,"lost")]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await row(id)).version).toBe(2);expect(await counts()).toEqual([2,2,2,2]);
});
test("invalid, stale, missing qualification and protected business transitions write nothing",async()=>{
  const {id}=await create();const before=await counts();await expect(move(id,1,"cycle_completed")).rejects.toThrow();expect(await counts()).toEqual(before);
  await move(id,1,"qualification");await db.update(s.clients).set({language:null}).where(eq(s.clients.id,clientId));const second=await counts();
  await expect(move(id,2,"consultation_needed")).rejects.toThrow("Заполните");await expect(move(id,1,"lost")).rejects.toThrow("изменён");
  await expect(move(id,2,"procedure_slot_selected")).rejects.toThrow("Требуется");expect(await counts()).toEqual(second);
});
test("every protected target rejects the public command even from an eligible stage",async()=>{
  for(const to of CYCLE_STAGES.filter(stage=>REQUIRED_COMMAND[stage])){
    const from=CYCLE_STAGES.find(stage=>TRANSITIONS[stage].includes(to))!;
    const [cycle]=await db.insert(s.treatmentCycles).values({studioId,clientId,zoneCode:"brows",kind:"pmu",stage:from,assignedMasterId:masterId}).returning();
    const before=await counts();await expect(move(cycle.id,1,to)).rejects.toThrow();expect(await counts()).toEqual(before);
  }
});
test("Master scope applies to client AND cycle on reads, writes and replay; other studio and AI denied",async()=>{
  const own=await create(),other=await create("eyes"),key=randomUUID();await move(own.id,1,"qualification",key);
  await db.update(s.treatmentCycles).set({assignedMasterId:otherMaster}).where(eq(s.treatmentCycles.id,other.id));
  const [foreignClient]=await db.insert(s.clients).values(clientFixture(foreignStudio)).returning();const [foreign]=await db.insert(s.treatmentCycles).values({studioId:foreignStudio,clientId:foreignClient.id,zoneCode:"brows",kind:"pmu"}).returning();
  await db.update(s.studioMembers).set({roleId:roles.MASTER}).where(eq(s.studioMembers.studioId,studioId));
  expect((await queries.getCycleBoard()).rows.map(r=>r.id)).toEqual([own.id]);
  for(const id of [other.id,foreign.id]){await expect(queries.getCycleTimeline(id)).rejects.toThrow();await expect(move(id,1,"qualification")).rejects.toThrow();}
  await db.update(s.clients).set({assignedMasterId:otherMaster}).where(eq(s.clients.id,clientId));
  await expect(move(own.id,1,"qualification",key)).rejects.toThrow();expect((await queries.getCycleBoard()).rows).toHaveLength(0);
  await db.update(s.studioMembers).set({roleId:roles.AI_SYSTEM}).where(eq(s.studioMembers.studioId,studioId));await expect(create()).rejects.toThrow();await expect(queries.getCycleBoard()).rejects.toThrow();
});
test("audit and outbox failures roll back cycle, version, history and receipt",async()=>{
  const audit=await import("@/server/services/audit-log.service");const spy=vi.spyOn(audit,"writeAudit").mockRejectedValueOnce(new Error("Audit unavailable"));
  try{await expect(create()).rejects.toThrow("Audit unavailable");}finally{spy.mockRestore();}expect(await counts()).toEqual([0,0,0,0]);
  const {id}=await create();const outbox=await import("@/server/events/outbox");const fail=vi.spyOn(outbox,"enqueue").mockRejectedValueOnce(new Error("Outbox unavailable"));
  try{await expect(move(id,1,"qualification")).rejects.toThrow("Outbox unavailable");}finally{fail.mockRestore();}
  expect(await counts()).toEqual([1,1,1,1]);expect(await row(id)).toMatchObject({stage:"new_lead",version:1});
});
test("SQL cannot change a stage without matching evidence or rewrite history",async()=>{
  const {id}=await create();await expect(db.update(s.treatmentCycles).set({stage:"cycle_completed",version:2}).where(eq(s.treatmentCycles.id,id))).rejects.toThrow();
  await expect(db.update(s.cycleStageHistory).set({reason:"Rewritten"}).where(eq(s.cycleStageHistory.cycleId,id))).rejects.toThrow();
  await expect(db.delete(s.cycleStageHistory).where(eq(s.cycleStageHistory.cycleId,id))).rejects.toThrow();
});
test("worker acknowledges each immutable historical version once, without pretending to send messages",async()=>{
  const {id}=await create();await move(id,1,"qualification");
  const {runWorkerOnce}=await import("@/server/events/worker"),{handlers}=await import("@/server/events/registry");
  await runWorkerOnce(handlers);await runWorkerOnce(handlers);await runWorkerOnce(handlers);
  const inbox=await db.select().from(s.eventInbox).where(eq(s.eventInbox.studioId,studioId));expect(inbox).toHaveLength(2);
  expect(inbox.map(r=>(r.result as {version:number}).version).sort()).toEqual([1,2]);
  expect(await db.select().from(s.outboxJobs).where(and(eq(s.outboxJobs.studioId,studioId),eq(s.outboxJobs.state,"completed")))).toHaveLength(2);
});
test("read logging fails closed and archived client blocks replay",async()=>{
  const key=randomUUID(),{id}=await create("brows",key);
  await db.execute(sql`alter table access_logs add constraint reject_cycle_timeline check (operation != 'cycles.timeline') NOT VALID`);
  try{await expect(queries.getCycleTimeline(id)).rejects.toThrow("Access logging unavailable");}finally{await db.execute(sql`alter table access_logs drop constraint reject_cycle_timeline`);}
  await db.update(s.clients).set({deletedAt:new Date()}).where(eq(s.clients.id,clientId));await expect(create("brows",key)).rejects.toThrow();
});
test("client merge preserves immutable cycle history and pending event references",async()=>{
  const key=randomUUID(),created=await create("brows",key);await move(created.id,1,"qualification");
  const before=(await queries.getCycleTimeline(created.id)).history;
  const [target]=await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:masterId}).returning();
  const merge=await import("@/features/clients/server/merge-actions"),{MERGE_FIELDS}=await import("@/features/clients/merge-contract");
  const preview=await merge.previewClientMerge({sourceId:clientId,targetId:target.id});
  await merge.mergeClientsAction({sourceId:clientId,targetId:target.id,token:preview.token,reason:"Verified duplicate",choices:Object.fromEntries(Object.keys(MERGE_FIELDS).map(field=>[field,"target" as const]))},randomUUID());
  const after=await queries.getCycleTimeline(created.id);expect(after.clientId).toBe(target.id);expect(after.history).toEqual(before);
  expect(await create("brows",key)).toEqual(created);
});
test("Admin may advance early stages; an explicit capability deny also blocks replay",async()=>{
  await db.update(s.studioMembers).set({roleId:roles.ADMIN}).where(eq(s.studioMembers.studioId,studioId));
  const key=randomUUID(),{id}=await create("brows",key);await move(id,1,"qualification");
  const [permission]=await db.select().from(s.permissions).where(eq(s.permissions.code,"CLIENT_UPDATE"));
  await db.insert(s.userCustomPermissions).values({studioId,userId:actor,permissionId:permission.id,effect:"deny"});
  await expect(create("brows",key)).rejects.toThrow();await expect(move(id,2,"lost")).rejects.toThrow();
});
test("lost cannot bypass linked appointments; suspension and an inactive master block progression",async()=>{
  const {id}=await create();const [service]=await db.insert(s.services).values({studioId,name:"Legacy",category:"brows",procedureType:"brows"}).returning();
  const [visit]=await db.insert(s.appointments).values({studioId,clientId,masterId,serviceId:service.id,startAt:new Date("2026-01-01T10:00:00Z"),endAt:new Date("2026-01-01T11:00:00Z"),source:"phone",createdById:actor,serviceSnapshot:{},clientSnapshot:{},masterSnapshot:{},priceSnapshotCents:0,durationSnapshotMinutes:60}).returning();
  await db.insert(s.appointmentCycles).values({studioId,clientId,appointmentId:visit.id,cycleId:id,visitKind:"consultation",serviceSnapshot:{}});
  await expect(move(id,1,"lost")).rejects.toThrow("визиты");await move(id,1,"qualification");
  await db.update(s.masters).set({isActive:false}).where(eq(s.masters.id,masterId));await expect(move(id,2,"consultation_needed")).rejects.toThrow("мастер недоступен");
  await db.update(s.treatmentCycles).set({suspendedAt:new Date(),suspensionReason:"Human review"}).where(eq(s.treatmentCycles.id,id));await expect(move(id,2,"consultation_needed")).rejects.toThrow("приостановлен");
});
test("strict commands reject caller-supplied stage, master, price and evidence flags",async()=>{
  for(const extra of [{stage:"cycle_completed"},{assignedMasterId:otherMaster},{price:10},{medicalClearance:true}]){
    await expect(commands.createCycleAction({...{clientId,zoneCode:"brows" as const,reason:"Client requested course"},...extra},randomUUID())).rejects.toThrow();
  }
  const {id}=await create();await expect(commands.transitionCycleAction({...{id,expectedVersion:1,to:"qualification" as const,reason:"Human review"},...{paymentConfirmed:true}},randomUUID())).rejects.toThrow();
  expect(await counts()).toEqual([1,1,1,1]);
});
