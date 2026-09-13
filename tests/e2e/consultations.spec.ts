import { test,expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { registerTestUser } from "../support/browser-auth";
import { createTestDatabase } from "../support/database";
import { studioFixture,clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";
test("Specialist qualifies a returning client and records a consultation outcome on mobile",async({page})=>{
 test.skip(!process.env.TEST_DATABASE_URL&&!process.env.CI,"Requires disposable PostgreSQL");if(!process.env.TEST_DATABASE_URL)throw new Error("CI requires TEST_DATABASE_URL");
 const database=await createTestDatabase(),db=database.db,email=`consultation-${randomUUID()}@example.test`;let studioId:string|undefined;
 try{
  const response=await registerTestUser(page.request,{data:{name:"Synthetic Specialist",email,password:"Synthetic-password-123!"}});expect(response.status()).toBe(200);const owner=(await response.json()).user;
  [studioId]=(await db.insert(s.studios).values(studioFixture()).returning()).map(r=>r.id);const [role]=await db.select().from(s.roles).where(eq(s.roles.code,"OWNER"));await db.insert(s.studioMembers).values({studioId,userId:owner.id,roleId:role.id});
  const [master]=await db.insert(s.masters).values({studioId,userId:owner.id,displayName:"Specialist"}).returning();const [client]=await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:master.id,language:"it",clientKind:"returning",reportedPreviousPmu:true,interestedZones:["brows"]}).returning();
  const [qualification]=await db.insert(s.treatmentCycles).values({studioId,clientId:client.id,assignedMasterId:master.id,kind:"pmu",zoneCode:"brows",stage:"qualification"}).returning();
  await page.setViewportSize({width:390,height:844});await page.goto(`/deals/${qualification.id}`);await page.getByLabel("PMU другого мастера").check();await page.getByLabel("Основание квалификации").fill("Reviewed prior PMU report");await page.getByRole("button",{name:"Проверить квалификацию",exact:true}).click();await expect(page.getByText(/По актуальной проверке нужна консультация/)).toBeVisible();
  // Calendar prerequisites are fixtures: this does not claim a working booking flow.
  const [cycle]=await db.insert(s.treatmentCycles).values({studioId,clientId:client.id,assignedMasterId:master.id,kind:"pmu",zoneCode:"brows",stage:"consultation_confirmed"}).returning();const [service]=await db.insert(s.services).values({studioId,name:"Synthetic consultation",category:"consultation",procedureType:"consultation"}).returning();
  const [visit]=await db.insert(s.appointments).values({studioId,clientId:client.id,masterId:master.id,serviceId:service.id,startAt:new Date(Date.now()-7200000),endAt:new Date(Date.now()-3600000),status:"completed",source:"phone",createdById:owner.id,serviceSnapshot:{},clientSnapshot:{},masterSnapshot:{},priceSnapshotCents:0,durationSnapshotMinutes:60}).returning();await db.insert(s.appointmentCycles).values({studioId,clientId:client.id,cycleId:cycle.id,appointmentId:visit.id,visitKind:"consultation",serviceSnapshot:{}});
  await page.goto(`/deals/${cycle.id}`);await page.getByLabel("Завершённый визит",{exact:true}).selectOption(visit.id);await page.getByLabel("Основание завершения").fill("Actual consultation completed");await page.getByRole("button",{name:"Зафиксировать завершение консультации",exact:true}).click();
  await page.getByLabel("Результат консультации",{exact:true}).selectOption("removal_required");await page.getByLabel("Причина решения").fill("Specialist requires removal evaluation");await page.getByLabel("Комментарий специалиста").fill("Discuss approved next steps");await page.getByRole("button",{name:"Сохранить решение",exact:true}).click();
  await expect(page.getByRole("link",{name:"Связанный Remover-цикл",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const [result]=await db.select().from(s.consultationResults).where(eq(s.consultationResults.studioId,studioId));const [remover]=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,result.removerCycleId!));expect(remover).toMatchObject({clientId:client.id,originCycleId:cycle.id,zoneCode:"brows",kind:"remover"});
  await page.reload();await expect(page.getByRole("link",{name:"Связанный Remover-цикл",exact:true})).toBeVisible();expect(await db.select().from(s.consultationResults).where(eq(s.consultationResults.studioId,studioId))).toHaveLength(1);
 }finally{try{if(studioId){await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId,studioId));await db.delete(s.studios).where(eq(s.studios.id,studioId));}await db.delete(s.user).where(eq(s.user.email,email));}finally{await database.close();}}
});
