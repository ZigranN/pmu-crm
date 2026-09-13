import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import { clients, studios, user } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const studioIds: string[] = [];
const forgedEmail = `${randomUUID()}@example.test`;
const authEmail = `${randomUUID()}@example.test`;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => {
  if (!database) return;
  try {
    await database.db.delete(user).where(inArray(user.email, [authEmail, forgedEmail]));
    if (studioIds.length) await database.db.delete(studios).where(inArray(studios.id, studioIds));
  } finally { await database.close(); }
});

test("client storage CRUD, scoped queries, foreign key and rollback", async () => {
  const db = database.db;
  const created = await db.insert(studios).values([studioFixture(), studioFixture()]).returning();
  studioIds.push(...created.map((s) => s.id));
  const [a, b] = created;
  const [client] = await db.insert(clients).values(clientFixture(a.id)).returning();
  expect(await db.select().from(clients).where(and(eq(clients.id, client.id), eq(clients.studioId, b.id)))).toEqual([]);
  await db.update(clients).set({ notes: "updated" }).where(eq(clients.id, client.id));
  expect((await db.select().from(clients).where(eq(clients.id, client.id)))[0].notes).toBe("updated");
  await expect(db.transaction(async (tx) => {
    await tx.update(clients).set({ notes: "rollback" }).where(eq(clients.id, client.id));
    throw new Error("rollback fixture");
  })).rejects.toThrow("rollback fixture");
  expect((await db.select().from(clients).where(eq(clients.id, client.id)))[0].notes).toBe("updated");
  await expect(db.insert(clients).values(clientFixture(randomUUID()))).rejects.toThrow();
  expect(await hasPermission(db, "non-member", a.id, "CLIENT_READ")).toBe(false);
  await db.delete(clients).where(eq(clients.id, client.id));
  expect(await db.select().from(clients).where(eq(clients.id, client.id))).toEqual([]);
});

test("actual auth configuration signs up, validates session and rejects wrong password", async () => {
  vi.doMock("@/db", () => ({ db: database.db }));
  const { auth } = await import("@/lib/auth");
  const signUp = await auth.api.signUpEmail({ body: {
    email: authEmail, password: "Synthetic-password-123!", name: "Synthetic Auth User",
  }, asResponse: true });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect(cookie).toContain("session_token");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.email).toBe(authEmail);
  expect(session?.user.role).toBe("CLIENT");
  const update = await auth.handler(new Request("http://127.0.0.1:3100/api/auth/update-user", {
    method: "POST", headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:3100" },
    body: JSON.stringify({ role: "SUPER_ADMIN" }),
  }));
  expect(update.status).toBe(400);
  expect((await database.db.select().from(user).where(eq(user.email, authEmail)))[0].role).toBe("CLIENT");
  const wrong = await auth.api.signInEmail({ body: { email: authEmail, password: "wrong-password" }, asResponse: true });
  expect(wrong.status).toBe(401);
  expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
});


test("HTTP signup cannot choose a privileged auth role", async () => {
  vi.doMock("@/db", () => ({ db: database.db }));
  const { auth } = await import("@/lib/auth");
  const response = await auth.handler(new Request("http://127.0.0.1:3100/api/auth/sign-up/email", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: forgedEmail, password: "Synthetic-password-123!", name: "Forged", role: "SUPER_ADMIN" }),
  }));
  expect([200, 400]).toContain(response.status);
  const saved = await database.db.select().from(user).where(eq(user.email, forgedEmail));
  if (response.status === 200) { expect(saved).toHaveLength(1); expect(saved[0].role).toBe("CLIENT"); }
  else expect(saved).toHaveLength(0);
});
