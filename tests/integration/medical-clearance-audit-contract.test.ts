import { beforeAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { writeAudit } from "@/server/services/audit-log.service";
import { AUDIT_ENTITIES, type AuditAction } from "@/lib/audit-contract";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import("@/db").db;

let studioId: string;
let userId: string;
let clientId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;

  const studios = await db
    .insert(s.studios)
    .values([studioFixture()])
    .returning();
  studioId = studios[0].id;

  userId = `user-${randomUUID()}`;
  await db.insert(s.user).values({
    id: userId,
    name: "Audit Tester",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [client] = await db
    .insert(s.clients)
    .values([clientFixture(studioId)])
    .returning();
  clientId = client.id;
});

test("A. New mapping accepted: medical_clearance_recorded + cycle_medical_clearance", async () => {
  const clearanceId = randomUUID();

  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      studioId,
      userId,
      action: "medical_clearance_recorded",
      entityType: "cycle_medical_clearance",
      entityId: clearanceId,
      before: null,
      after: { decision: "CLEARED", reason: "Fit for procedure" },
      reason: "Medical clearance recorded by doctor",
      reasonSource: "user",
    });
  });

  const logs = await db
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, clearanceId));

  expect(logs).toHaveLength(1);
  expect(logs[0].action).toBe("medical_clearance_recorded");
  expect(logs[0].entityType).toBe("cycle_medical_clearance");
  expect(logs[0].reason).toBe("Medical clearance recorded by doctor");
  expect(logs[0].reasonSource).toBe("user");
  expect(logs[0].contractVersion).toBe(1);
});

test("B. Incorrect mappings rejected", async () => {
  const clearanceId = randomUUID();

  // B1. medical_clearance_recorded + client_medical_profile
  await expect(
    db.transaction(async (tx) => {
      await writeAudit(tx, {
        studioId,
        userId,
        action: "medical_clearance_recorded",
        entityType: "client_medical_profile",
        entityId: clearanceId,
        before: null,
        after: {},
        reason: "Invalid mapping test",
        reasonSource: "user",
      });
    })
  ).rejects.toThrow("Invalid audit event contract");

  // B2. medical_profile_updated + cycle_medical_clearance
  await expect(
    db.transaction(async (tx) => {
      await writeAudit(tx, {
        studioId,
        userId,
        action: "medical_profile_updated",
        entityType: "cycle_medical_clearance",
        entityId: clearanceId,
        before: null,
        after: {},
        reason: "Invalid mapping test",
        reasonSource: "user",
      });
    })
  ).rejects.toThrow("Invalid audit event contract");
});

test("C. Existing audit mappings preserved", async () => {
  // Verify AUDIT_ENTITIES constant has all required mappings
  expect(AUDIT_ENTITIES.medical_clearance_recorded).toBe("cycle_medical_clearance");
  expect(AUDIT_ENTITIES.medical_profile_updated).toBe("client_medical_profile");
  expect(AUDIT_ENTITIES.commercial_terms_confirmed).toBe("cycle_commercial_terms");
  expect(AUDIT_ENTITIES.cycle_created).toBe("treatment_cycle");
  expect(AUDIT_ENTITIES.client_created).toBe("client");

  // Verify writeAudit succeeds for sample existing action/entity pairs
  const testEntities: Array<{ action: AuditAction; entityType: typeof AUDIT_ENTITIES[AuditAction]; entityId: string }> = [
    { action: "medical_profile_updated", entityType: "client_medical_profile", entityId: randomUUID() },
    { action: "commercial_terms_confirmed", entityType: "cycle_commercial_terms", entityId: randomUUID() },
    { action: "client_updated", entityType: "client", entityId: clientId },
    { action: "cycle_created", entityType: "treatment_cycle", entityId: randomUUID() },
  ];

  for (const item of testEntities) {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        studioId,
        userId,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        before: {},
        after: {},
        reason: `Preservation test for ${item.action}`,
        reasonSource: "command",
      });
    });

    const rows = await db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.entityId, item.entityId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].action).toBe(item.action);
    expect(rows[0].entityType).toBe(item.entityType);
  }
});

test("D. Database constraint directly validates and rejects at PostgreSQL level", async () => {
  const clearanceId = randomUUID();

  // Valid insert directly via SQL
  await db.execute(sql`
    INSERT INTO audit_logs (
      studio_id, user_id, action, contract_version, old_values, new_values, reason, reason_source, entity_type, entity_id
    ) VALUES (
      ${studioId}, ${userId}, 'medical_clearance_recorded', 1, 'null'::jsonb, '{"decision":"CLEARED"}'::jsonb, 'Valid SQL insert', 'user', 'cycle_medical_clearance', ${clearanceId}
    )
  `);

  const inserted = await db
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, clearanceId));
  expect(inserted).toHaveLength(1);
  expect(inserted[0].action).toBe("medical_clearance_recorded");
  expect(inserted[0].entityType).toBe("cycle_medical_clearance");

  // Invalid entityType for medical_clearance_recorded must violate audit_logs_contract_check
  await expect(
    db.execute(sql`
      INSERT INTO audit_logs (
        studio_id, user_id, action, contract_version, old_values, new_values, reason, reason_source, entity_type, entity_id
      ) VALUES (
        ${studioId}, ${userId}, 'medical_clearance_recorded', 1, 'null'::jsonb, '{}'::jsonb, 'Invalid SQL insert', 'user', 'client_medical_profile', ${randomUUID()}
      )
    `)
  ).rejects.toThrow();

  // Invalid action must violate audit_logs_contract_check
  await expect(
    db.execute(sql`
      INSERT INTO audit_logs (
        studio_id, user_id, action, contract_version, old_values, new_values, reason, reason_source, entity_type, entity_id
      ) VALUES (
        ${studioId}, ${userId}, 'medical_profile_updated', 1, 'null'::jsonb, '{}'::jsonb, 'Invalid SQL insert', 'user', 'cycle_medical_clearance', ${randomUUID()}
      )
    `)
  ).rejects.toThrow();
});

test("E. Atomic rejection: invalid audit input rolls back surrounding transaction without leaving audit rows", async () => {
  const tempClientId = randomUUID();
  const testClearanceId = randomUUID();

  const auditCountBefore = (await db.select().from(s.auditLogs)).length;

  await expect(
    db.transaction(async (tx) => {
      // Create a test record
      await tx.insert(s.clients).values({
        id: tempClientId,
        studioId,
        firstName: "Should Rollback",
        fullName: "Should Rollback Client",
        phone: "+390001112233",
        clientStatus: "new_lead",
      });

      // Write invalid audit mapping
      await writeAudit(tx, {
        studioId,
        userId,
        action: "medical_clearance_recorded",
        entityType: "client_medical_profile",
        entityId: testClearanceId,
        before: null,
        after: {},
        reason: "Atomic rollback test",
        reasonSource: "user",
      });
    })
  ).rejects.toThrow();

  // Verify client was not inserted (rolled back)
  const clients = await db
    .select()
    .from(s.clients)
    .where(eq(s.clients.id, tempClientId));
  expect(clients).toHaveLength(0);

  // Verify no audit log was inserted
  const auditLogs = await db
    .select()
    .from(s.auditLogs)
    .where(eq(s.auditLogs.entityId, testClearanceId));
  expect(auditLogs).toHaveLength(0);

  const auditCountAfter = (await db.select().from(s.auditLogs)).length;
  expect(auditCountAfter).toBe(auditCountBefore);
});
