import { beforeAll, beforeEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import type { Registry } from "@/server/events/worker";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;
let actions: typeof import("@/features/clients/server/actions");
let events: typeof import("@/server/events/outbox");
let worker: typeof import("@/server/events/worker");
let recovery: typeof import("@/features/jobs/server/actions");
let queries: typeof import("@/features/jobs/server/queries");
const owner = randomUUID(); let studioId: string, clientId: string, ownerRole: string, adminRole: string;
const input = { firstName: "Idempotent", phone: "+390000000000", clientStatus: "new_lead" as const };
beforeAll(async () => {
  database = await createTestDatabase(); vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;
  actions = await import("@/features/clients/server/actions"); events = await import("@/server/events/outbox"); worker = await import("@/server/events/worker");
  recovery = await import("@/features/jobs/server/actions"); queries = await import("@/features/jobs/server/queries");
  [studioId] = (await db.insert(s.studios).values(studioFixture()).returning()).map(r => r.id);
  await db.insert(s.user).values({ id: owner, name: "Synthetic", email: `${owner}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() });
  const roles = await db.select().from(s.roles); ownerRole = roles.find(r => r.code === "OWNER")!.id; adminRole = roles.find(r => r.code === "ADMIN")!.id;
  await db.insert(s.studioMembers).values({ studioId, userId: owner, roleId: ownerRole });
});
beforeEach(async () => {
  session.id = owner;
  await db.delete(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioId));
  await db.delete(s.eventInbox).where(eq(s.eventInbox.studioId, studioId));
  await db.delete(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
  await db.delete(s.clients).where(eq(s.clients.studioId, studioId));
  await db.update(s.studioMembers).set({ roleId: ownerRole, isActive: true }).where(eq(s.studioMembers.userId, owner));
  await db.update(s.studios).set({ isActive: true }).where(eq(s.studios.id, studioId));
  [clientId] = (await db.insert(s.clients).values({ ...clientFixture(studioId), ltvCents: 0 }).returning()).map(r => r.id);
});
afterAll(async () => {
  if (!database) return;
  try { await db.delete(s.auditLogs).where(eq(s.auditLogs.studioId, studioId)); await db.delete(s.studios).where(eq(s.studios.id, studioId)); await db.delete(s.user).where(eq(s.user.id, owner)); }
  finally { await database.close(); }
});
async function add(handler = "test.domain.v1", maxAttempts = 3, future = false) {
  return db.transaction(tx => events.enqueue(tx, { studioId, eventKey: randomUUID(), handler, maxAttempts, effectType: handler === "test.external.v1" ? "external" : "transactional",
    ...(future ? { availableAt: new Date(Date.now() + 3600000) } : {}) }, { clientId }));
}
async function due(id: string) { await db.update(s.outboxJobs).set({ availableAt: sql`now() - interval '1 second'` }).where(eq(s.outboxJobs.id, id)); }
async function row(id: string) { return (await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.id, id)))[0]; }
async function counter() { return (await db.select().from(s.clients).where(eq(s.clients.id, clientId)))[0].ltvCents; }
const domain: Registry = { "test.domain.v1": { kind: "transactional", async run(tx) {
  await tx.update(s.clients).set({ ltvCents: sql`${s.clients.ltvCents} + 1` }).where(eq(s.clients.id, clientId)); return { processed: true };
} } };

test("parallel client requests commit one client, audit, activity, receipt and outbox event; replay after response loss", async () => {
  const key = randomUUID(); const results = await Promise.all(Array.from({ length: 5 }, () => actions.createClientAction(input, key)));
  expect(new Set(results.map(r => r.id)).size).toBe(1);
  expect(await actions.createClientAction({ ...input }, key)).toEqual(results[0]);
  expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(2);
  expect(await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId))).toHaveLength(1);
  expect(await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioId))).toHaveLength(1);
  expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.studioId, studioId))).toHaveLength(1);
  expect(await db.select().from(s.activityEvents).where(eq(s.activityEvents.clientId, results[0].id))).toHaveLength(1);
});
test("same key with different data conflicts and revoked access cannot replay a receipt", async () => {
  const key = randomUUID(); await actions.createClientAction(input, key);
  await expect(actions.createClientAction({ ...input, firstName: "Different" }, key)).rejects.toThrow("другими данными");
  await db.update(s.studioMembers).set({ isActive: false }).where(eq(s.studioMembers.userId, owner));
  await expect(actions.createClientAction(input, key)).rejects.toThrow("Permission denied");
});
test("audit failure rolls back domain write, receipt, activity and queued event", async () => {
  await db.execute(sql`create or replace function test_command_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'audit failure'; end $$`);
  await db.execute(sql`create trigger test_command_audit_fail before insert on audit_logs for each row execute function test_command_audit_fail()`);
  const key = randomUUID();
  try { await expect(actions.createClientAction(input, key)).rejects.toThrow(); }
  finally { await db.execute(sql`drop trigger test_command_audit_fail on audit_logs`); await db.execute(sql`drop function test_command_audit_fail()`); }
  expect(await db.select().from(s.commandReceipts).where(eq(s.commandReceipts.studioId, studioId))).toHaveLength(0);
  expect(await db.select().from(s.outboxJobs).where(eq(s.outboxJobs.studioId, studioId))).toHaveLength(0);
  expect(await db.select().from(s.clients).where(eq(s.clients.studioId, studioId))).toHaveLength(1);
  await actions.createClientAction(input, key);
});
test("verified inbox duplicates execute once; conflicting payload is rejected", async () => {
  const key = randomUUID();
  const consume = () => db.transaction(tx => events.consumeOnce(tx, studioId, "test.webhook.v1", key, { clientId }, async () => {
    await tx.update(s.clients).set({ ltvCents: sql`${s.clients.ltvCents} + 1` }).where(eq(s.clients.id, clientId)); return { accepted: true };
  }));
  expect(await Promise.all([consume(), consume(), consume()])).toEqual([{ accepted: true }, { accepted: true }, { accepted: true }]);
  expect(await counter()).toBe(1);
  await expect(db.transaction(tx => events.consumeOnce(tx, studioId, "test.webhook.v1", key, {}, async () => ({})))).rejects.toThrow("Inbox payload conflict");
});
test("outbox deduplicates within tenant/handler and rejects a reused key with different payload", async () => {
  const key = randomUUID(), data = { studioId, eventKey: key, handler: "test.domain.v1" };
  const a = await db.transaction(tx => events.enqueue(tx, data, { clientId }));
  expect((await db.transaction(tx => events.enqueue(tx, data, { clientId }))).id).toBe(a.id);
  await expect(db.transaction(tx => events.enqueue(tx, data, { other: true }))).rejects.toThrow("Event key payload conflict");
});
test("two workers claim different jobs and committed inbox prevents a repeated domain effect", async () => {
  const a = await add(), b = await add();
  await Promise.all([worker.runWorkerOnce(domain), worker.runWorkerOnce(domain)]);
  expect((await row(a.id)).state).toBe("completed"); expect((await row(b.id)).state).toBe("completed"); expect(await counter()).toBe(2);
  await db.update(s.outboxJobs).set({ state: "pending" }).where(eq(s.outboxJobs.id, a.id)); await due(a.id);
  await worker.runWorkerOnce(domain); expect(await counter()).toBe(2);
});
test("scheduled job waits; expired transactional lease is reclaimed with a new token", async () => {
  const job = await add("test.domain.v1", 3, true); expect(await worker.runWorkerOnce(domain)).toBe(false);
  const oldToken = randomUUID();
  await db.update(s.outboxJobs).set({ state: "processing", leaseToken: oldToken, leaseUntil: sql`now() - interval '1 second'`, attempts: 1 }).where(eq(s.outboxJobs.id, job.id));
  await db.insert(s.jobAttempts).values({ id: oldToken, jobId: job.id, mode: "processing" });
  await worker.runWorkerOnce(domain);
  expect((await row(job.id)).state).toBe("completed"); expect(await counter()).toBe(1);
  expect((await db.select().from(s.jobAttempts).where(eq(s.jobAttempts.id, oldToken)))[0].outcome).toBe("expired");
});
test("failed transactional handler rolls back effects/inbox, backs off and exhausts into dead letter", async () => {
  const job = await add("test.domain.v1", 2);
  const failing: Registry = { "test.domain.v1": { kind: "transactional", async run(tx) {
    await tx.update(s.clients).set({ ltvCents: 99 }).where(eq(s.clients.id, clientId)); throw new Error("secret provider detail");
  } } };
  await worker.runWorkerOnce(failing); expect((await row(job.id)).state).toBe("pending"); expect(await counter()).toBe(0);
  expect(await worker.runWorkerOnce(failing)).toBe(false);
  expect(await db.select().from(s.eventInbox).where(eq(s.eventInbox.studioId, studioId))).toHaveLength(0);
  await due(job.id); await worker.runWorkerOnce(failing);
  expect(await row(job.id)).toMatchObject({ state: "dead", attempts: 2, lastError: "handler_failure" });
});
test("ambiguous external send reconciles by stable job reference without sending twice", async () => {
  const job = await add("test.external.v1"); let calls = 0;
  const external: Registry = { "test.external.v1": { kind: "external", async send(current) {
    expect(current.id).toBe(job.id); calls++; throw new Error("timeout after provider accepted");
  }, async reconcile(current) { expect(current.id).toBe(job.id); return { status: "delivered", externalId: "provider-123" }; } } };
  await worker.runWorkerOnce(external); expect((await row(job.id)).state).toBe("uncertain");
  await due(job.id); await worker.runWorkerOnce(external);
  expect(await row(job.id)).toMatchObject({ state: "completed", externalId: "provider-123" }); expect(calls).toBe(1);
});
test("safe authoritative absence allows retry; unknown reconciliation never resends", async () => {
  const job = await add("test.external.v1", 3); let sends = 0;
  const external: Registry = { "test.external.v1": { kind: "external", async send() { sends++; throw new Error("ambiguous"); }, async reconcile() { return { status: "unknown" }; } } };
  await worker.runWorkerOnce(external); await due(job.id); await worker.runWorkerOnce(external); await due(job.id); await worker.runWorkerOnce(external);
  expect(await row(job.id)).toMatchObject({ state: "uncertain", attempts: 3 }); expect(sends).toBe(1);
  await due(job.id); expect(await worker.runWorkerOnce(external)).toBe(false);
  await db.update(s.outboxJobs).set({ attempts: 1 }).where(eq(s.outboxJobs.id, job.id));
  const safe: Registry = { "test.external.v1": { kind: "external", async send() { sends++; return { externalId: "safe-2" }; }, async reconcile() { return { status: "safe_to_retry" }; } } };
  await worker.runWorkerOnce(safe); expect((await row(job.id)).state).toBe("pending"); await due(job.id); await worker.runWorkerOnce(safe);
  expect((await row(job.id)).state).toBe("completed"); expect(sends).toBe(2);
});
test("late external completion cannot overwrite a newer lease", async () => {
  const job = await add("test.external.v1"); const newToken = randomUUID();
  const external: Registry = { "test.external.v1": { kind: "external", async send() {
    await db.update(s.outboxJobs).set({ leaseToken: newToken }).where(eq(s.outboxJobs.id, job.id)); return { externalId: "stale" };
  }, async reconcile() { return { status: "unknown" }; } } };
  await worker.runWorkerOnce(external);
  expect(await row(job.id)).toMatchObject({ state: "processing", leaseToken: newToken, externalId: null });
});
test("inactive studio and unknown handler cannot execute effects", async () => {
  const job = await add(); await db.update(s.studios).set({ isActive: false }).where(eq(s.studios.id, studioId));
  expect(await worker.runWorkerOnce(domain)).toBe(false); expect(await counter()).toBe(0);
  await db.update(s.studios).set({ isActive: true }).where(eq(s.studios.id, studioId));
  await worker.runWorkerOnce({}); expect(await row(job.id)).toMatchObject({ state: "dead", lastError: "unknown_handler" });
});
test("Owner recovery is audited; Admin cannot inspect or recover; pending task cannot be recovered twice", async () => {
  const job = await add("client.created.v1"); await db.update(s.outboxJobs).set({ state: "dead" }).where(eq(s.outboxJobs.id, job.id));
  await db.update(s.studioMembers).set({ roleId: adminRole }).where(eq(s.studioMembers.userId, owner));
  await expect(queries.getJobs(studioId)).rejects.toThrow("Permission denied");
  await expect(recovery.recoverJob({ id: job.id, reason: "Recovered dependency" })).rejects.toThrow("Permission denied");
  await db.update(s.studioMembers).set({ roleId: ownerRole }).where(eq(s.studioMembers.userId, owner));
  expect(await queries.getJobs(studioId)).toHaveLength(1);
  await recovery.recoverJob({ id: job.id, reason: "Recovered dependency" }); expect((await row(job.id)).state).toBe("pending");
  await expect(recovery.recoverJob({ id: job.id, reason: "Double click" })).rejects.toThrow();
  expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, job.id))).toEqual([expect.objectContaining({ action: "job_recovered", reason: "Recovered dependency" })]);
});

test("expired external lease reconciles instead of resending after a process crash", async () => {
  const job = await add("test.external.v1"); let sends = 0, checks = 0;
  const token = randomUUID(); await db.update(s.outboxJobs).set({ state: "processing", attempts: 1, leaseToken: token, leaseUntil: sql`now() - interval '1 second'` }).where(eq(s.outboxJobs.id, job.id));
  await db.insert(s.jobAttempts).values({ id: token, jobId: job.id, mode: "processing" });
  const external: Registry = { "test.external.v1": { kind: "external", async send() { sends++; return { externalId: "unexpected" }; },
    async reconcile() { checks++; return { status: "delivered", externalId: "before-crash" }; } } };
  await worker.runWorkerOnce(external);
  expect(await row(job.id)).toMatchObject({ state: "completed", externalId: "before-crash" }); expect(sends).toBe(0); expect(checks).toBe(1);
});
test("worker timeout leaves uncertain delivery and never stores provider error text", async () => {
  const job = await add("test.external.v1");
  const external: Registry = { "test.external.v1": { kind: "external", async send() { return new Promise(() => {}); }, async reconcile() { return { status: "unknown" }; } } };
  await worker.runWorkerOnce(external, 5);
  expect(await row(job.id)).toMatchObject({ state: "uncertain", lastError: "delivery_unknown", leaseToken: null });
});
test("recovery and journal reject a different studio; ambiguous task cannot become pending", async () => {
  const [other] = await db.insert(s.studios).values(studioFixture()).returning();
  try {
    const foreign = await db.transaction(tx => events.enqueue(tx, { studioId: other.id, handler: "client.created.v1", eventKey: randomUUID() }, { clientId }));
    await db.update(s.outboxJobs).set({ state: "dead" }).where(eq(s.outboxJobs.id, foreign.id));
    await expect(recovery.recoverJob({ id: foreign.id, reason: "Forbidden" })).rejects.toThrow();
    await expect(queries.getJobs(other.id)).rejects.toThrow("Permission denied");
    const job = await add("client.created.v1"); await db.update(s.outboxJobs).set({ state: "uncertain" }).where(eq(s.outboxJobs.id, job.id));
    await expect(recovery.recoverJob({ id: job.id, reason: "No blind retry" })).rejects.toThrow("проверка внешней отправки");
    expect((await row(job.id)).state).toBe("uncertain");
  } finally { await db.delete(s.studios).where(eq(s.studios.id, other.id)); }
});
test("scheduler endpoint fails closed without a secret and runs only for authorized requests", async () => {
  const { POST } = await import("@/app/api/internal/jobs/route");
  try {
    vi.stubEnv("WORKER_SECRET", ""); expect((await POST(new Request("http://localhost/api/internal/jobs", { method: "POST" }))).status).toBe(503);
    const secret = "test-only-worker-secret-at-least-32-characters"; vi.stubEnv("WORKER_SECRET", secret);
    expect((await POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const job = await add("client.created.v1");
    const result = await POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ processed: 1 }); expect((await row(job.id)).state).toBe("completed");
  } finally { vi.unstubAllEnvs(); }
});
test("persisted external effect type cannot silently change into a transactional handler", async () => {
  const job = await add("test.external.v1");
  await db.update(s.outboxJobs).set({ state: "uncertain" }).where(eq(s.outboxJobs.id, job.id));
  let ran = false;
  await worker.runWorkerOnce({ "test.external.v1": { kind: "transactional", async run() { ran = true; return {}; } } });
  expect(ran).toBe(false); expect(await row(job.id)).toMatchObject({ state: "uncertain", lastError: "handler_kind_mismatch", attempts: 3 });
});
