import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture,clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";
test("Owner creates a cycle, retries a lost transition response, and sees guarded stages and history on mobile",async({page})=>{
  test.skip(!process.env.TEST_DATABASE_URL&&!process.env.CI,"Requires disposable PostgreSQL");if(!process.env.TEST_DATABASE_URL)throw new Error("CI requires TEST_DATABASE_URL");
  const database=await createTestDatabase(),db=database.db,email=`cycle-command-${randomUUID()}@example.test`;let studioId:string|undefined;
  try{
    const response=await registerTestUser(page.request,{data:{name:"Synthetic Owner",email,password:"Synthetic-password-123!"}});expect(response.status()).toBe(200);const owner=(await response.json()).user;
    [studioId]=(await db.insert(s.studios).values(studioFixture()).returning()).map(r=>r.id);
    const [role]=await db.select().from(s.roles).where(eq(s.roles.code,"OWNER"));await db.insert(s.studioMembers).values({studioId,userId:owner.id,roleId:role.id});
    const [master]=await db.insert(s.masters).values({studioId,displayName:"Synthetic"}).returning();
    const [client]=await db.insert(s.clients).values({...clientFixture(studioId),assignedMasterId:master.id,language:"it",clientKind:"new",reportedPreviousPmu:false,interestedZones:["brows"]}).returning();
    await page.setViewportSize({width:390,height:844});await page.goto("/settings");await page.getByRole("link",{name:/Циклы процедур/}).click();
    await page.getByLabel("Клиент",{exact:true}).selectOption(client.id);await page.getByLabel("Причина создания").fill("Client requests brows");await page.getByRole("button",{name:"Создать цикл",exact:true}).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);const id=page.url().split("/").pop()!;
    await page.getByLabel("Следующая стадия").selectOption("qualification");await page.getByLabel("Причина перехода").fill("Qualification started");
    let lost=false;await page.route(`**/deals/${id}`,async route=>{if(!lost&&route.request().method()==="POST"&&route.request().headers()["next-action"]){lost=true;await route.fetch();await route.abort("failed");}else await route.continue();});
    const submit=page.getByRole("button",{name:"Изменить стадию",exact:true});await submit.click();
    await expect.poll(async()=>(await db.select().from(s.cycleStageHistory).where(eq(s.cycleStageHistory.cycleId,id))).length).toBe(2);
    await expect(submit).toBeEnabled();await page.unroute(`**/deals/${id}`);await submit.click();await expect(page.getByText("Стадия: Квалификация",{exact:true})).toBeVisible();expect(lost).toBe(true);
    for(const [to,reason] of [["consultation_needed","Qualification reviewed"],["consultation_offered","Consultation offered to client"]]){
      await page.getByLabel("Следующая стадия").selectOption(to);await page.getByLabel("Причина перехода").fill(reason);await submit.click();await expect(page.getByText(reason,{exact:true})).toBeVisible();
    }
    await page.getByLabel("Следующая стадия").selectOption("consultation_scheduled");await expect(page.getByRole("status")).toContainText("календарь");await expect(submit).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const [cycle]=await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id,id));expect(cycle).toMatchObject({version:4,stage:"consultation_offered"});
    expect((await db.select().from(s.clients).where(eq(s.clients.id,client.id)))[0].clientStatus).toBe("new_lead");
    expect(await db.select().from(s.cycleStageHistory).where(eq(s.cycleStageHistory.cycleId,id))).toHaveLength(4);
  }finally{try{if(studioId){await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId,studioId));await db.delete(s.studios).where(eq(s.studios.id,studioId));}await db.delete(s.user).where(eq(s.user.email,email));}finally{await database.close();}}
});
