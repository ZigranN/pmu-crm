import { registerTestUser } from "../support/browser-auth";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "../../src/db/schema";
test("Owner resolves merge conflicts on mobile, retries a lost response and opens the old client URL", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL && !process.env.CI, "Requires disposable PostgreSQL");
  if (!process.env.TEST_DATABASE_URL) throw new Error("CI requires TEST_DATABASE_URL");
  const database = await createTestDatabase(), db = database.db;
  const email = `merge-${randomUUID()}@example.test`; let studioId: string | undefined;
  try {
    const response = await registerTestUser(page.request, { data: { name: "Synthetic Owner", email, password: "Synthetic-password-123!" } });
    expect(response.status()).toBe(200); const owner = (await response.json()).user;
    [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(row=>row.id);
    const [role] = await db.select().from(s.roles).where(eq(s.roles.code,"OWNER"));
    await db.insert(s.studioMembers).values({studioId,userId:owner.id,roleId:role.id});
    const [source,target] = await db.insert(s.clients).values([{...clientFixture(studioId),firstName:"Anna",fullName:"Anna",notes:"Preserved source note"},{...clientFixture(studioId),firstName:"Anna Maria",fullName:"Anna Maria",notes:"Target note"}]).returning();
    await db.insert(s.activityEvents).values({studioId,clientId:source.id,type:"client_created",title:"Original historic event"});
    await page.setViewportSize({width:390,height:844}); await page.goto(`/clients/${target.id}`);
    await page.getByRole("link",{name:"Объединить с другой карточкой"}).click();
    await page.getByLabel("Карточка-дубль").selectOption(source.id);
    await page.getByRole("button",{name:"Проверить объединение",exact:true}).click();
    const commit = page.getByRole("button",{name:"Объединить и сохранить историю",exact:true}); await expect(commit).toBeDisabled();
    await page.getByRole("button",{name:"Выбрать значения основной карточки",exact:true}).click();
    await page.getByRole("group",{name:"Заметки",exact:true}).getByRole("radio",{name:"Дубль: Preserved source note",exact:true}).check();
    await page.getByLabel("Причина объединения",{exact:true}).fill("Checked same person and history");
    await page.getByRole("checkbox",{name:"Я проверил карточки: это один человек",exact:true}).check();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    let lost = false; await page.route(`**/clients/${target.id}/merge`, async route => {
      if (!lost && route.request().method()==="POST" && route.request().headers()["next-action"]) { lost=true; await route.fetch(); await route.abort("failed"); } else await route.continue();
    });
    await commit.click(); await expect.poll(async()=>(await db.select().from(s.clientMerges).where(eq(s.clientMerges.sourceId,source.id))).length).toBe(1);
    await expect(commit).toBeEnabled(); await page.unroute(`**/clients/${target.id}/merge`); await commit.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${target.id}$`)); expect(lost).toBe(true);
    await page.goto(`/clients/${source.id}`); await expect(page).toHaveURL(new RegExp(`/clients/${target.id}$`));
    await page.getByRole("tab",{name:"История"}).click(); await expect(page.getByText("Original historic event",{exact:true})).toBeVisible();
    const [saved] = await db.select().from(s.clients).where(eq(s.clients.id,target.id)); expect(saved.notes).toBe("Preserved source note");
    const records = await db.select().from(s.clientMerges).where(eq(s.clientMerges.sourceId,source.id)); expect(records).toHaveLength(1); expect(records[0].provenance.notes).toBe(source.id);
    await page.goto(`/clients/${target.id}/merge`); await expect(page.getByText(/Объединение .*Checked same person/)).toBeVisible();
  } finally { try { if(studioId) {await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId,studioId));await db.delete(s.studios).where(eq(s.studios.id,studioId));} await db.delete(s.user).where(eq(s.user.email,email)); } finally {await database.close();} }
});
