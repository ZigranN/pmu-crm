import { beforeAll,beforeEach,afterEach,afterAll,test,expect,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and,eq,sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture,clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { OUTCOMES } from "@/features/consultations/contracts";
import { withinTwoCalendarYears,evaluateQualification } from "@/features/consultations/server/qualification";
const session=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/auth",()=>({auth:{api:{getSession:async()=>({user:{id:session.id}})}}}));vi.mock("next/headers",()=>({headers:async()=>new Headers()}));vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
let database:Awaited<ReturnType<typeof createTestDatabase>>,db:typeof import("@/db").db;
let actions:typeof import("@/features/consultations/server/results"),queries:typeof import("@/features/consultations/server/queries");
let studioId:string,foreignStudio:string,clientId:string,masterId:string,serviceId:string,roles:Record<string,string>;
const actor=randomUUID(),risks={otherMasterPmu:false,doubt:false,conditionChanged:false,evaluationRequired:false};
beforeAll(async()=>{database=await createTestDatabase();vi.doMock("@/db",()=>({db:database.db}));db=(await import("@/db")).db;actions=await import("@/features/consultations/server/results");queries=await import("@/features/consultations/server/queries");await db.insert(s.user).values({id:actor,name:"Synthetic Specialist",email:`${actor}@example.test`,emailVerified:false,createdAt:new Date(),updatedAt:new Date()});roles=Object.fromEntries((await db.select().from(s.roles)).map(r=>[r.code,r.id]));});
beforeEach(async()=>{session.id=actor;[studioId,foreignStudio]=(await db.insert(s.studios).values([studioFixture(),studioFixture()]).returning()).map(r=>r.id);await db.insert(s.studioMembers).values({studioId,userId:actor,roleId:roles.OWNER});[masterId]=(await db.insert(s.masters).values({studioId,userId:actor,displayName:"Assigned"}).returning()).map(r=>r.id);[clientId]=(await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:masterId,language:"it",clientKind:"returning",reportedPreviousPmu:true,interestedZones:["brows","eyes","lips"]}).returning()).map(r=>r.id);[serviceId]=(await db.insert(s.services).values({studioId,name:"Synthetic",category:"consultation",procedureType:"consultation"}).returning()).map(r=>r.id);});
afterEach(async()=>{await db.delete(s.studios).where(eq(s.studios.id,studioId));await db.delete(s.studios).where(eq(s.studios.id,foreignStudio));});
afterAll(async()=>{try{await db.delete(s.user).where(eq(s.user.id,actor));}finally{await database.close();}});
async function cycle(extra:Partial<typeof s.treatmentCycles.$inferInsert>={}){return(await db.insert(s.treatmentCycles).values({studioId,clientId,zoneCode:"brows",kind:"pmu",stage:"qualification",assignedMasterId:masterId,...extra}).returning())[0];}
async function visit(c:typeof s.treatmentCycles.$inferSelect,extra:Partial<typeof s.appointments.$inferInsert>={},kind="consultation"){
 const [v]=await db.insert(s.appointments).values({studioId,clientId:c.clientId,masterId,serviceId,startAt:new Date(Date.now()-3*86400000),endAt:new Date(Date.now()-2*86400000),status:"completed",source:"phone",createdById:actor,serviceSnapshot:{},clientSnapshot:{},masterSnapshot:{},priceSnapshotCents:0,durationSnapshotMinutes:60,...extra}).returning();
 await db.insert(s.appointmentCycles).values({studioId,clientId:c.clientId,cycleId:c.id,appointmentId:v.id,visitKind:kind,serviceSnapshot:{}});return v;
}
async function completed(){const c=await cycle({stage:"consultation_confirmed"}),v=await visit(c);const result=await actions.completeConsultationAction({id:c.id,expectedVersion:1,appointmentId:v.id,reason:"Consultation actually finished"},randomUUID());return{c,v,...result};}
const qualification=(id:string,version=1,extra:Partial<typeof risks>={},key=randomUUID())=>actions.qualifyCycleAction({id,expectedVersion:version,...risks,...extra,reason:"Specialist reviewed CRM and risks"},key);
const resultInput=(record:Awaited<ReturnType<typeof completed>>,outcome:typeof OUTCOMES[number])=>({id:record.id,expectedVersion:record.version,consultationId:record.consultationId,outcome,reason:"Specialist decision",comment:"Review commentary",reassessmentAt:outcome==="temporarily_unavailable"?new Date(Date.now()+10*86400000).toISOString():null});
async function count(){return Promise.all([s.consultations,s.consultationResults,s.cycleQualifications,s.cycleStageHistory,s.commandReceipts,s.outboxJobs].map(t=>db.select({id:t.id}).from(t).where(eq(t.studioId,studioId)).then(r=>r.length)));}
test("two calendar years is inclusive in studio local dates, leap years and future dates are explicit",()=>{
 expect(withinTwoCalendarYears(new Date("2024-09-14T12:00:00Z"),new Date("2026-09-14T18:00:00Z"),"Europe/Rome")).toBe(true);
 expect(withinTwoCalendarYears(new Date("2024-09-13T12:00:00Z"),new Date("2026-09-14T18:00:00Z"),"Europe/Rome")).toBe(false);
 expect(withinTwoCalendarYears(new Date("2022-02-28T10:00:00Z"),new Date("2024-02-29T10:00:00Z"),"Europe/Rome")).toBe(true);
 expect(withinTwoCalendarYears(new Date("2027-01-01"),new Date("2026-09-14"),"Europe/Rome")).toBe(false);
 expect(withinTwoCalendarYears(new Date("2024-09-13T22:30:00Z"),new Date("2026-09-14T12:00:00Z"),"Europe/Rome")).toBe(true);
});
test("returning label alone cannot bypass consultation; qualification is replay-safe and records reasons",async()=>{
 const c=await cycle(),key=randomUUID(),first=await qualification(c.id,1,{},key);expect(await qualification(c.id,1,{},key)).toEqual(first);
 const panel=await queries.getConsultationPanel(c.id);expect(panel.qualification?.consultationRequired).toBe(true);expect(panel.stage).toBe("consultation_needed");expect(await db.select().from(s.cycleQualifications).where(eq(s.cycleQualifications.cycleId,c.id))).toHaveLength(1);
});
test("only verified same-zone recent procedures allow omission; all four risk flags override it and live history changes invalidate it",async()=>{
 const history=await cycle({stage:"cycle_completed"}),v=await visit(history,{},"session_1");
 await db.insert(s.procedureSessions).values({studioId,clientId,masterId,serviceId,appointmentId:v.id,cycleId:history.id,procedureArea:"brows",procedureType:"brows",sessionType:"primary_session"});
 const c=await cycle();await qualification(c.id);expect((await queries.getConsultationPanel(c.id)).qualification?.consultationRequired).toBe(false);
 for(const risk of Object.keys(risks)){const fresh=await cycle();await qualification(fresh.id,1,{[risk]:true});expect((await queries.getConsultationPanel(fresh.id)).qualification?.consultationRequired).toBe(true);}
 const eyes=await cycle({zoneCode:"eyes"});await qualification(eyes.id);expect((await queries.getConsultationPanel(eyes.id)).qualification?.consultationRequired).toBe(true);
 await db.update(s.appointments).set({status:"cancelled"}).where(eq(s.appointments.id,v.id));const [client]=await db.select().from(s.clients).where(eq(s.clients.id,clientId));
 expect((await db.transaction(tx=>evaluateQualification(tx,c,client,risks,new Date()))).consultationRequired).toBe(true);
});
test("different master history and unlinked legacy procedures require a consultation",async()=>{
 const h=await cycle(),v=await visit(h,{},"session_1"),[other]=await db.insert(s.masters).values({studioId,displayName:"Other"}).returning();
 await db.insert(s.procedureSessions).values({studioId,clientId,masterId:other.id,serviceId,appointmentId:v.id,cycleId:h.id,procedureArea:"brows",procedureType:"brows",sessionType:"primary_session"});
 await db.update(s.appointments).set({masterId:other.id}).where(eq(s.appointments.id,v.id));
 const c=await cycle();await qualification(c.id);expect((await queries.getConsultationPanel(c.id)).qualification?.consultationRequired).toBe(true);
});
test.each(OUTCOMES)("human outcome %s retains its dedicated branch and does not alter medical clearance or price",async outcome=>{
 const done=await completed(),key=randomUUID(),input=resultInput(done,outcome);const result=await actions.recordConsultationResultAction(input,key);expect(await actions.recordConsultationResultAction(input,key)).toEqual(result);
 const panel=await queries.getConsultationPanel(done.id);expect(panel.result?.outcome).toBe(outcome);expect(panel.result?.reason).toBe(input.reason);
 expect(panel.stage).toBe(outcome==="client_thinking"?"thinking":outcome==="master_cannot_help"?"lost":"consultation_result");
 expect(panel.suspended).toBe(["removal_required","temporarily_unavailable"].includes(outcome));
 if(outcome==="removal_required"){const [remover]=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,result.removerCycleId!));expect(remover).toMatchObject({originCycleId:done.id,zoneCode:"brows",clientId,kind:"remover"});expect(remover.commercialSnapshot).toBeNull();}
 if(outcome==="client_thinking")expect(panel.result?.followUpAt!.getTime()).toBeGreaterThan(Date.now()+6*86400000);
 if(outcome==="temporarily_unavailable")expect(panel.result?.reassessmentAt?.toISOString()).toBe(input.reassessmentAt);
 expect(await db.select().from(s.clientMedicalProfiles).where(eq(s.clientMedicalProfiles.clientId,clientId))).toHaveLength(0);
 await expect(actions.recordConsultationResultAction(input,randomUUID())).rejects.toThrow();
});
test("completion needs a linked ended completed consultation of the assigned master and cannot run twice",async()=>{
 const c=await cycle({stage:"consultation_confirmed"}),v=await visit(c,{status:"confirmed"});const input={id:c.id,expectedVersion:1,appointmentId:v.id,reason:"Completion checked"};const before=await count();
 await expect(actions.completeConsultationAction(input,randomUUID())).rejects.toThrow();expect(await count()).toEqual(before);
 await db.update(s.appointments).set({status:"completed",endAt:new Date(Date.now()+86400000)}).where(eq(s.appointments.id,v.id));await expect(actions.completeConsultationAction(input,randomUUID())).rejects.toThrow();
 await db.update(s.appointments).set({endAt:new Date(Date.now()-3600000)}).where(eq(s.appointments.id,v.id));const key=randomUUID();const first=await actions.completeConsultationAction(input,key);expect(await actions.completeConsultationAction(input,key)).toEqual(first);await expect(actions.completeConsultationAction(input,randomUUID())).rejects.toThrow();
});
test("unavailable requires future reassessment and commentary; caller cannot inject clearance",async()=>{
 const done=await completed(),input=resultInput(done,"temporarily_unavailable"),before=await count();
 await expect(actions.recordConsultationResultAction({...input,reassessmentAt:null},randomUUID())).rejects.toThrow();await expect(actions.recordConsultationResultAction({...input,comment:""},randomUUID())).rejects.toThrow();await expect(actions.recordConsultationResultAction({...input,reassessmentAt:new Date(0).toISOString()},randomUUID())).rejects.toThrow();
 await expect(actions.recordConsultationResultAction({...input,...{medicalClearance:true}},randomUUID())).rejects.toThrow();expect(await count()).toEqual(before);
});
test("Admin and AI cannot record clinical decisions; Master needs both client and cycle scope; reads respect medical deny",async()=>{
 const done=await completed();
 for(const role of ["ADMIN","AI_SYSTEM"]){await db.update(s.studioMembers).set({roleId:roles[role]}).where(eq(s.studioMembers.studioId,studioId));await expect(actions.recordConsultationResultAction(resultInput(done,"can_proceed"),randomUUID())).rejects.toThrow();}
 await db.update(s.studioMembers).set({roleId:roles.MASTER}).where(eq(s.studioMembers.studioId,studioId));expect((await queries.getConsultationPanel(done.id)).canWrite).toBe(true);
 const [other]=await db.insert(s.masters).values({studioId,displayName:"Other"}).returning();await db.update(s.treatmentCycles).set({assignedMasterId:other.id}).where(eq(s.treatmentCycles.id,done.id));await expect(queries.getConsultationPanel(done.id)).rejects.toThrow();await expect(actions.recordConsultationResultAction(resultInput(done,"can_proceed"),randomUUID())).rejects.toThrow();
 await db.update(s.treatmentCycles).set({assignedMasterId:masterId}).where(eq(s.treatmentCycles.id,done.id));const [permission]=await db.select().from(s.permissions).where(eq(s.permissions.code,"MEDICAL_PROFILE_READ"));await db.insert(s.userCustomPermissions).values({studioId,userId:actor,permissionId:permission.id,effect:"deny"});await expect(queries.getConsultationPanel(done.id)).rejects.toThrow();
});
test("outbox failure rolls back result, linked Remover, history, suspension and receipt",async()=>{
 const done=await completed(),before=await count(),cyclesBefore=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId,studioId));
 const outbox=await import("@/server/events/outbox"),spy=vi.spyOn(outbox,"enqueue").mockRejectedValueOnce(new Error("Outbox unavailable"));try{await expect(actions.recordConsultationResultAction(resultInput(done,"removal_required"),randomUUID())).rejects.toThrow("Outbox unavailable");}finally{spy.mockRestore();}
 expect(await count()).toEqual(before);expect(await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId,studioId))).toEqual(cyclesBefore);
});
test("overdue job creates one task, replay cannot duplicate it, and result closes it",async()=>{
 const done=await completed(),{runWorkerOnce}=await import("@/server/events/worker"),{handlers}=await import("@/server/events/registry");
 for(let i=0;i<4;i++)await runWorkerOnce(handlers);
 const panel=await queries.getConsultationPanel(done.id);expect(panel.task?.status).toBe("pending");
 const [job]=await db.select().from(s.outboxJobs).where(and(eq(s.outboxJobs.studioId,studioId),eq(s.outboxJobs.handler,"consultation.decision-due.v1")));await db.update(s.outboxJobs).set({state:"pending",availableAt:new Date(0)}).where(eq(s.outboxJobs.id,job.id));await runWorkerOnce(handlers);
 expect(await db.select().from(s.tasks).where(eq(s.tasks.consultationId,done.consultationId))).toHaveLength(1);
 await actions.recordConsultationResultAction(resultInput(done,"can_proceed"),randomUUID());expect((await queries.getConsultationPanel(done.id)).task?.status).toBe("completed");
});
test("decision before worker suppresses task and read logging fails closed",async()=>{
 const done=await completed();await actions.recordConsultationResultAction(resultInput(done,"can_proceed"),randomUUID());const {runWorkerOnce}=await import("@/server/events/worker"),{handlers}=await import("@/server/events/registry");for(let i=0;i<5;i++)await runWorkerOnce(handlers);expect((await queries.getConsultationPanel(done.id)).task).toBeNull();
 await db.execute(sql`alter table access_logs add constraint reject_consultation_read check (operation!='consultations.read') NOT VALID`);try{await expect(queries.getConsultationPanel(done.id)).rejects.toThrow("Access logging unavailable");}finally{await db.execute(sql`alter table access_logs drop constraint reject_consultation_read`);}
});
test("concurrent competing outcomes commit once; result evidence cannot be rewritten",async()=>{
 const done=await completed();const outcomes=await Promise.allSettled([actions.recordConsultationResultAction(resultInput(done,"can_proceed"),randomUUID()),actions.recordConsultationResultAction(resultInput(done,"removal_required"),randomUUID())]);expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 await expect(db.update(s.consultationResults).set({outcome:"master_cannot_help"}).where(eq(s.consultationResults.consultationId,done.consultationId))).rejects.toThrow();
});
test("client merge preserves qualifications, consultation evidence, decisions and pending job identity",async()=>{
 const q=await cycle();await qualification(q.id);const done=await completed();await actions.recordConsultationResultAction(resultInput(done,"removal_required"),randomUUID());
 const before=await queries.getConsultationPanel(done.id),[target]=await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:masterId}).returning();
 const merge=await import("@/features/clients/server/merge-actions"),{MERGE_FIELDS}=await import("@/features/clients/merge-contract");const preview=await merge.previewClientMerge({sourceId:clientId,targetId:target.id});
 await merge.mergeClientsAction({sourceId:clientId,targetId:target.id,token:preview.token,reason:"Verified same person",choices:Object.fromEntries(Object.keys(MERGE_FIELDS).map(field=>[field,"target" as const]))},randomUUID());
 const after=await queries.getConsultationPanel(done.id);expect(after.latest).toEqual(before.latest);expect(after.result).toEqual(before.result);expect((await queries.getConsultationPanel(q.id)).qualification?.id).toBeTruthy();
 const [child]=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,after.result!.removerCycleId!));expect(child.clientId).toBe(target.id);expect(child.originCycleId).toBe(done.id);
});
test("foreign studio, wrong client visit and revoked capability cannot complete or replay a decision",async()=>{
 const done=await completed(),key=randomUUID(),input=resultInput(done,"can_proceed");await actions.recordConsultationResultAction(input,key);
 const [foreignClient]=await db.insert(s.clients).values(clientFixture(foreignStudio)).returning();const [foreign]=await db.insert(s.treatmentCycles).values({studioId:foreignStudio,clientId:foreignClient.id,kind:"pmu",zoneCode:"brows",stage:"qualification"}).returning();await expect(qualification(foreign.id)).rejects.toThrow();
 const wrong=await cycle({stage:"consultation_confirmed"});await expect(actions.completeConsultationAction({id:wrong.id,expectedVersion:1,appointmentId:done.v.id,reason:"Wrong cycle"},randomUUID())).rejects.toThrow();
 await db.update(s.studioMembers).set({roleId:roles.MASTER}).where(eq(s.studioMembers.studioId,studioId));const [permission]=await db.select().from(s.permissions).where(eq(s.permissions.code,"MEDICAL_PROFILE_UPDATE"));await db.insert(s.userCustomPermissions).values({studioId,userId:actor,permissionId:permission.id,effect:"deny"});await expect(actions.recordConsultationResultAction(input,key)).rejects.toThrow();
});
test("future decision deadline creates no task when worker runs early",async()=>{
 const c=await cycle({stage:"consultation_confirmed"}),v=await visit(c,{endAt:new Date(Date.now()-60000)});const done=await actions.completeConsultationAction({id:c.id,expectedVersion:1,appointmentId:v.id,reason:"Just completed"},randomUUID());
 const {runWorkerOnce}=await import("@/server/events/worker"),{handlers}=await import("@/server/events/registry");for(let i=0;i<4;i++)await runWorkerOnce(handlers);
 expect(await db.select().from(s.tasks).where(eq(s.tasks.consultationId,done.consultationId))).toHaveLength(0);
});
test("decision tasks cannot reference another studio or client",async()=>{
 const done=await completed();await expect(db.insert(s.tasks).values({studioId:foreignStudio,assignedToId:actor,consultationId:done.consultationId,title:"Foreign",type:"custom"})).rejects.toThrow();
 const [other]=await db.insert(s.clients).values(clientFixture(studioId)).returning();await expect(db.insert(s.tasks).values({studioId,clientId:other.id,appointmentId:done.v.id,assignedToId:actor,consultationId:done.consultationId,title:"Wrong client",type:"custom"})).rejects.toThrow();
});

async function followUp(outcome: "client_thinking" | "temporarily_unavailable") {
 const done=await completed(),input=resultInput(done,outcome),key=randomUUID();
 await actions.recordConsultationResultAction(input,key);
 const [job]=await db.select().from(s.outboxJobs).where(and(eq(s.outboxJobs.studioId,studioId),eq(s.outboxJobs.handler,"cycle.follow-up-due.v1")));
 const [decision]=await db.select().from(s.consultationResults).where(eq(s.consultationResults.consultationId,done.consultationId));
 return {done,input,key,job,decision,dueAt:(decision.followUpAt??decision.reassessmentAt)!};
}
// Only the handler's clock read is advanced. Source decisions remain immutable;
// scheduling, inbox and task writes still use the real transaction/database.
async function deliverFollowUp(job:typeof s.outboxJobs.$inferSelect,now:Date) {
 const {createFollowUpTask}=await import("@/features/treatment-cycles/server/followups");
 return db.transaction(async tx=>{const clock=vi.spyOn(tx,"execute").mockResolvedValueOnce([{now}] as never);try{return await createFollowUpTask(tx,job);}finally{clock.mockRestore();}});
}
test.each(["client_thinking","temporarily_unavailable"] as const)("%s schedules exactly one durable task at the authoritative date",async outcome=>{
 const f=await followUp(outcome);expect(f.job.availableAt).toEqual(f.dueAt);
 await actions.recordConsultationResultAction(f.input,f.key);
 expect(await db.select().from(s.outboxJobs).where(and(eq(s.outboxJobs.studioId,studioId),eq(s.outboxJobs.handler,"cycle.follow-up-due.v1")))).toHaveLength(1);
 const {RetryableJobError}=await import("@/server/events/worker");
 await expect(deliverFollowUp(f.job,new Date(f.dueAt.getTime()-1))).rejects.toBeInstanceOf(RetryableJobError);
 expect(await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id))).toHaveLength(0);
 const first=await deliverFollowUp(f.job,f.dueAt);expect(await deliverFollowUp(f.job,new Date(f.dueAt.getTime()+86400000))).toEqual(first);
 const rows=await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id));expect(rows).toHaveLength(1);
 expect(rows[0]).toMatchObject({clientId,assignedToId:actor,appointmentId:f.done.v.id,consultationId:null,dueAt:f.dueAt,status:"pending"});
 expect(rows[0].description).toBe(`/deals/${f.done.id}`);expect(rows[0].description).not.toContain(f.input.comment);
 expect((await queries.getConsultationPanel(f.done.id)).followUpTask?.id).toBe(rows[0].id);
 await db.update(s.tasks).set({status:"completed",completedAt:new Date()}).where(eq(s.tasks.id,rows[0].id));
 await deliverFollowUp(f.job,f.dueAt);expect((await queries.getConsultationPanel(f.done.id)).followUpTask?.status).toBe("completed");
});
test("follow-up ignores archived cycle/client and rejects another studio, missing master and injected dates",async()=>{
 const f=await followUp("temporarily_unavailable"),{PermanentJobError}=await import("@/server/events/worker");
 await expect(deliverFollowUp({...f.job,studioId:foreignStudio},f.dueAt)).rejects.toBeInstanceOf(PermanentJobError);
 await expect(deliverFollowUp({...f.job,payload:{resultId:f.decision.id,dueAt:new Date(0).toISOString()}},f.dueAt)).rejects.toBeInstanceOf(PermanentJobError);
 await db.update(s.masters).set({isActive:false}).where(eq(s.masters.id,masterId));await expect(deliverFollowUp(f.job,f.dueAt)).rejects.toBeInstanceOf(PermanentJobError);
 await db.update(s.masters).set({isActive:true}).where(eq(s.masters.id,masterId));
 await db.update(s.treatmentCycles).set({archivedAt:new Date()}).where(eq(s.treatmentCycles.id,f.done.id));expect(await deliverFollowUp(f.job,f.dueAt)).toMatchObject({skipped:"archived_cycle"});
 await db.update(s.treatmentCycles).set({archivedAt:null}).where(eq(s.treatmentCycles.id,f.done.id));await db.update(s.clients).set({deletedAt:new Date()}).where(eq(s.clients.id,clientId));expect(await deliverFollowUp(f.job,f.dueAt)).toMatchObject({skipped:"archived_client"});
 expect(await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id))).toHaveLength(0);
});
test("reassessment never clears suspension; stale suspension and revoked specialist permissions block reminders",async()=>{
 const f=await followUp("temporarily_unavailable"),{PermanentJobError}=await import("@/server/events/worker");
 await db.update(s.studioMembers).set({roleId:roles.ADMIN}).where(eq(s.studioMembers.studioId,studioId));await expect(deliverFollowUp(f.job,f.dueAt)).rejects.toBeInstanceOf(PermanentJobError);
 await db.update(s.studioMembers).set({roleId:roles.OWNER}).where(eq(s.studioMembers.studioId,studioId));
 const before=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,f.done.id));await deliverFollowUp(f.job,f.dueAt);expect(await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,f.done.id))).toEqual(before);
 await db.update(s.treatmentCycles).set({suspendedAt:null,suspensionReason:null}).where(eq(s.treatmentCycles.id,f.done.id));expect(await deliverFollowUp(f.job,f.dueAt)).toMatchObject({skipped:"cycle_changed"});
});
test("follow-up DB guard rejects changed date, missing client, foreign studio and detached source",async()=>{
 const f=await followUp("client_thinking");await deliverFollowUp(f.job,f.dueAt);
 const [task]=await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id));
 for(const patch of [{dueAt:new Date(0)},{clientId:null},{studioId:foreignStudio},{followUpResultId:null},{consultationId:f.done.consultationId}])await expect(db.update(s.tasks).set(patch).where(eq(s.tasks.id,task.id))).rejects.toThrow();
 expect(await db.select().from(s.tasks).where(eq(s.tasks.id,task.id))).toEqual([task]);
});
test("follow-up task follows canonical client after merge and retries preserve its identity",async()=>{
 const f=await followUp("client_thinking");await deliverFollowUp(f.job,f.dueAt);
 const [target]=await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:masterId}).returning();
 const merge=await import("@/features/clients/server/merge-actions"),{MERGE_FIELDS}=await import("@/features/clients/merge-contract");
 const preview=await merge.previewClientMerge({sourceId:clientId,targetId:target.id});
 await merge.mergeClientsAction({sourceId:clientId,targetId:target.id,reason:"Synthetic duplicate",token:preview.token,choices:Object.fromEntries(Object.keys(MERGE_FIELDS).map(field=>[field,"target" as const]))},randomUUID());
 await deliverFollowUp(f.job,f.dueAt);
 const rows=await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id));expect(rows).toHaveLength(1);expect(rows[0].clientId).toBe(target.id);
});
test("follow-up enqueue failure rolls back human decision and stage evidence",async()=>{
 const done=await completed(),before=await count(),outbox=await import("@/server/events/outbox"),original=outbox.enqueue;
 const spy=vi.spyOn(outbox,"enqueue").mockImplementation(async(tx,envelope,payload)=>{if(envelope.handler==="cycle.follow-up-due.v1")throw new Error("Follow-up queue unavailable");return original(tx,envelope,payload);});
 try{await expect(actions.recordConsultationResultAction(resultInput(done,"client_thinking"),randomUUID())).rejects.toThrow("Follow-up queue unavailable");}finally{spy.mockRestore();}
 expect(await count()).toEqual(before);
});
test("worker commits follow-up task and inbox together; replay and migration catch-up cannot duplicate them",async()=>{
 const f=await followUp("client_thinking"),{runWorkerOnce}=await import("@/server/events/worker"),{handlers}=await import("@/server/events/registry");
 const handler=handlers["cycle.follow-up-due.v1"];if(handler.kind!=="transactional")throw new Error("Expected transactional handler");
 const registry={...handlers,"cycle.follow-up-due.v1":{kind:"transactional" as const,run:async(tx:Parameters<typeof handler.run>[0],job:typeof f.job)=>{const clock=vi.spyOn(tx,"execute").mockResolvedValueOnce([{now:f.dueAt}] as never);try{return await handler.run(tx,job);}finally{clock.mockRestore();}}}};
 await db.update(s.outboxJobs).set({availableAt:new Date(0)}).where(eq(s.outboxJobs.id,f.job.id));
 const run=await runWorkerOnce(registry);expect(run).toBeTruthy();
 const [task]=await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id));expect(task).toBeDefined();
 await db.update(s.outboxJobs).set({state:"pending",availableAt:new Date(0)}).where(eq(s.outboxJobs.id,f.job.id));await runWorkerOnce(registry);
 expect(await db.select().from(s.tasks).where(eq(s.tasks.followUpResultId,f.decision.id))).toHaveLength(1);
 expect(await db.select().from(s.eventInbox).where(and(eq(s.eventInbox.studioId,studioId),eq(s.eventInbox.consumer,f.job.handler)))).toHaveLength(1);
 const {readFile}=await import("node:fs/promises");const migration=await readFile("drizzle/0017_cycle_follow_up_tasks.sql","utf8");const catchup=migration.slice(migration.indexOf("INSERT INTO outbox_jobs"));
 await db.delete(s.outboxJobs).where(eq(s.outboxJobs.id,f.job.id));await db.execute(sql.raw(catchup));await db.execute(sql.raw(catchup));
 const jobs=await db.select().from(s.outboxJobs).where(and(eq(s.outboxJobs.studioId,studioId),eq(s.outboxJobs.handler,f.job.handler)));expect(jobs).toHaveLength(1);expect(jobs[0]).toMatchObject({payload:f.job.payload,payloadHash:f.job.payloadHash,availableAt:f.dueAt});
});
test("follow-up task cannot be routed to a master without current client scope",async()=>{
 const f=await followUp("client_thinking");await db.update(s.studioMembers).set({roleId:roles.MASTER}).where(eq(s.studioMembers.studioId,studioId));
 const [other]=await db.insert(s.masters).values({studioId,displayName:"Other assigned master"}).returning();await db.update(s.clients).set({assignedMasterId:other.id}).where(eq(s.clients.id,clientId));
 const {PermanentJobError}=await import("@/server/events/worker");await expect(deliverFollowUp(f.job,f.dueAt)).rejects.toBeInstanceOf(PermanentJobError);
});
