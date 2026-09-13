import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";
test("Owner reviews unmatched legacy visits on mobile without converting data", async ({page}) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI,"Requires disposable PostgreSQL");
  if(!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database=await createTestDatabase(), db=database.db;
  const email=`cycle-report-${randomUUID()}@example.test`; let studioId:string|undefined;
  try {
    const response=await registerTestUser(page.request,{data:{name:"Synthetic Owner",email,password:"Synthetic-password-123!"}});
    expect(response.status()).toBe(200); const owner=(await response.json()).user;
    [studioId]=(await db.insert(s.studios).values(studioFixture()).returning()).map(row=>row.id);
    const [role]=await db.select().from(s.roles).where(eq(s.roles.code,"OWNER"));
    await db.insert(s.studioMembers).values({studioId,userId:owner.id,roleId:role.id});
    const [client]=await db.insert(s.clients).values(clientFixture(studioId)).returning();
    const [master]=await db.insert(s.masters).values({studioId,displayName:"Synthetic"}).returning();
    const [service]=await db.insert(s.services).values({studioId,name:"Legacy",category:"brows",procedureType:"brows"}).returning();
    const [visit]=await db.insert(s.appointments).values({studioId,clientId:client.id,masterId:master.id,serviceId:service.id,startAt:new Date("2026-01-01T10:00:00Z"),endAt:new Date("2026-01-01T11:00:00Z"),source:"phone",createdById:owner.id,serviceSnapshot:{legacy:true},clientSnapshot:{},masterSnapshot:{},priceSnapshotCents:100,durationSnapshotMinutes:60}).returning();
    await page.setViewportSize({width:390,height:844}); await page.goto("/settings");
    await page.getByRole("link",{name:/Разбор старых записей/}).click();
    await expect(page.getByRole("heading",{name:"Старые записи: проверка циклов"})).toBeVisible();
    await expect(page.getByText(`Визит: ${visit.id}`,{exact:true})).toBeVisible();
    await expect(page.getByText("Услуга не сопоставлена с каталогом",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect((await db.select().from(s.appointments).where(eq(s.appointments.id,visit.id)))[0]).toEqual(visit);
    expect(await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId,studioId))).toHaveLength(0);
    expect((await db.select().from(s.accessLogs).where(eq(s.accessLogs.studioId,studioId))).some(row=>row.operation==="cycles.legacy.report" && row.recordIds.includes(visit.id))).toBe(true);
  } finally {try {if(studioId) await db.delete(s.studios).where(eq(s.studios.id,studioId)); await db.delete(s.user).where(eq(s.user.email,email));} finally {await database.close();}}
});
