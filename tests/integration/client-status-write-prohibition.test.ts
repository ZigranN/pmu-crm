import { beforeAll, beforeEach, afterEach, afterAll, test, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { clientSchema, type ClientSchema } from "@/features/clients/schemas/client.schema";
import { MERGE_FIELDS } from "@/features/clients/merge-contract";

const session = vi.hoisted(() => ({ id: "", studioId: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.id } }) } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (name === "pmu_active_studio" && session.studioId ? { value: session.studioId } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>, db: typeof import("@/db").db;
let clientActions: typeof import("@/features/clients/server/actions");
let mergeActions: typeof import("@/features/clients/server/merge-actions");
let cycleActions: typeof import("@/features/treatment-cycles/server/actions");
let consultationActions: typeof import("@/features/consultations/server/results");

let studioId: string, masterId: string, roleIds: Record<string, string>;
const actor = randomUUID();

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));
  db = (await import("@/db")).db;
  clientActions = await import("@/features/clients/server/actions");
  mergeActions = await import("@/features/clients/server/merge-actions");
  cycleActions = await import("@/features/treatment-cycles/server/actions");
  consultationActions = await import("@/features/consultations/server/results");

  await db.insert(s.user).values({
    id: actor,
    name: "Test Admin",
    email: `${actor}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  roleIds = Object.fromEntries((await db.select().from(s.roles)).map(r => [r.code, r.id]));
});

beforeEach(async () => {
  session.id = actor;
  [studioId] = (await db.insert(s.studios).values([studioFixture()]).returning()).map(r => r.id);
  session.studioId = studioId;
  await db.insert(s.studioMembers).values({ studioId, userId: actor, roleId: roleIds.OWNER });
  [masterId] = (await db.insert(s.masters).values([{ studioId, userId: actor, displayName: "Primary Master" }]).returning()).map(r => r.id);
});

afterEach(async () => {
  await db.delete(s.studios).where(eq(s.studios.id, studioId));
});

afterAll(async () => {
  try {
    await db.delete(s.user).where(eq(s.user.id, actor));
  } finally {
    await database.close();
  }
});

test("Create invariant: caller cannot supply clientStatus; client is created with server default 'new_lead'", async () => {
  // 1. Schema rejects clientStatus due to .strict()
  const payloadWithStatus = {
    firstName: "Alice",
    phone: "+393331112233",
    clientStatus: "completed",
  };
  const parseResult = clientSchema.safeParse(payloadWithStatus);
  expect(parseResult.success).toBe(false);

  // 2. createClientAction creates client with server-enforced 'new_lead'
  const validPayload: ClientSchema = {
    firstName: "Alice",
    phone: "+393331112233",
  };
  const created = await clientActions.createClientAction(validPayload, randomUUID());
  const [persisted] = await db.select().from(s.clients).where(eq(s.clients.id, created.id));
  expect(persisted.clientStatus).toBe("new_lead");
});

test("Update invariant: updateClientAction rejects clientStatus and leaves stored status unchanged", async () => {
  // Create client and manually set legacy status to 'contacted'
  const [client] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(studioId),
      firstName: "Bob",
      phone: "+393332223344",
      clientStatus: "contacted",
    })
    .returning();

  // 1. Attempting to pass clientStatus via updateClientAction is rejected by schema
  const payloadWithStatus = {
    firstName: "Bob Renamed",
    phone: "+393332223344",
    clientStatus: "completed",
  } as unknown as ClientSchema;
  await expect(clientActions.updateClientAction(client.id, payloadWithStatus)).rejects.toThrow();

  // 2. Normal update changes name/phone but leaves clientStatus completely untouched
  const validUpdate: ClientSchema = {
    firstName: "Bob Updated",
    phone: "+393332223344",
    notes: "Updated note",
  };
  await clientActions.updateClientAction(client.id, validUpdate);

  const [after] = await db.select().from(s.clients).where(eq(s.clients.id, client.id));
  expect(after.firstName).toBe("Bob Updated");
  expect(after.notes).toBe("Updated note");
  expect(after.clientStatus).toBe("contacted"); // Unchanged!

  // 3. No client_status_changed audit log is emitted
  const audits = await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, client.id));
  expect(audits.some(a => a.action === "client_status_changed")).toBe(false);
  expect(audits.some(a => a.action === "client_updated")).toBe(true);
});

test("Merge invariant: clientStatus is absent from MERGE_FIELDS and target clientStatus is preserved", async () => {
  expect("clientStatus" in MERGE_FIELDS).toBe(false);

  const [source] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(studioId),
      firstName: "Source Client",
      phone: "+393334445566",
      clientStatus: "lost",
      notes: "Source note",
    })
    .returning();

  const [target] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(studioId),
      firstName: "Target Client",
      phone: "+393334445577",
      clientStatus: "appointment_booked",
      notes: "Target note",
    })
    .returning();

  const preview = await mergeActions.previewClientMerge({ sourceId: source.id, targetId: target.id });
  expect(preview.fields.some(f => f.field === ("clientStatus" as any))).toBe(false);

  // Execute merge
  await mergeActions.mergeClientsAction(
    {
      sourceId: source.id,
      targetId: target.id,
      token: preview.token,
      reason: "Duplicate records for same person",
      choices: Object.fromEntries(
        Object.keys(MERGE_FIELDS).map(field => [field, "target" as const])
      ),
    },
    randomUUID()
  );

  const [mergedTarget] = await db.select().from(s.clients).where(eq(s.clients.id, target.id));
  expect(mergedTarget.clientStatus).toBe("appointment_booked"); // Preserved from target!
});

test("Cycle command invariant: treatment cycle transitions and consultation decisions do NOT write clientStatus", async () => {
  const [client] = await db
    .insert(s.clients)
    .values({
      ...clientFixture(studioId),
      firstName: "Cycle Client",
      phone: "+393339998877",
      clientStatus: "new_lead",
      assignedMasterId: masterId,
      language: "it",
      clientKind: "new",
      reportedPreviousPmu: false,
      interestedZones: ["brows"],
    })
    .returning();

  // 1. Create cycle
  const cycle = await cycleActions.createCycleAction(
    { clientId: client.id, zoneCode: "brows", reason: "Initial consultation request" },
    randomUUID()
  );

  // 2. Advance cycle stages
  await cycleActions.transitionCycleAction(
    { id: cycle.id, expectedVersion: 1, to: "qualification", reason: "Qualification started" },
    randomUUID()
  );
  await consultationActions.qualifyCycleAction(
    {
      id: cycle.id,
      expectedVersion: 2,
      otherMasterPmu: false,
      doubt: false,
      conditionChanged: false,
      evaluationRequired: true,
      reason: "Consultation required by specialist",
    },
    randomUUID()
  );
  await cycleActions.transitionCycleAction(
    { id: cycle.id, expectedVersion: 3, to: "consultation_offered", reason: "Consultation offered to client" },
    randomUUID()
  );

  // Assert client.clientStatus remains unchanged in database
  const [afterTransitions] = await db.select().from(s.clients).where(eq(s.clients.id, client.id));
  expect(afterTransitions.clientStatus).toBe("new_lead");

  // 3. Complete consultation and record result
  const [confirmedCycle] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client.id,
      zoneCode: "lips",
      kind: "pmu",
      stage: "consultation_confirmed",
      assignedMasterId: masterId,
      version: 1,
    })
    .returning();

  const [service] = await db
    .insert(s.services)
    .values({ studioId, name: "Consultation Service", category: "consultation", procedureType: "consultation" })
    .returning();

  const [appointment] = await db
    .insert(s.appointments)
    .values({
      studioId,
      clientId: client.id,
      masterId,
      serviceId: service.id,
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() - 1800000),
      status: "completed",
      source: "phone",
      createdById: actor,
      serviceSnapshot: {},
      clientSnapshot: {},
      masterSnapshot: {},
      priceSnapshotCents: 0,
      durationSnapshotMinutes: 30,
    })
    .returning();

  await db.insert(s.appointmentCycles).values({
    studioId,
    clientId: client.id,
    cycleId: confirmedCycle.id,
    appointmentId: appointment.id,
    visitKind: "consultation",
    serviceSnapshot: {},
  });

  const completed = await consultationActions.completeConsultationAction(
    { id: confirmedCycle.id, expectedVersion: 1, appointmentId: appointment.id, reason: "Consultation finished" },
    randomUUID()
  );

  const [afterComplete] = await db.select().from(s.clients).where(eq(s.clients.id, client.id));
  expect(afterComplete.clientStatus).toBe("new_lead"); // Still unchanged!

  await consultationActions.recordConsultationResultAction(
    {
      id: completed.id,
      expectedVersion: completed.version,
      consultationId: completed.consultationId,
      outcome: "can_proceed",
      reason: "Client can proceed with procedure",
    },
    randomUUID()
  );

  const [afterResult] = await db.select().from(s.clients).where(eq(s.clients.id, client.id));
  expect(afterResult.clientStatus).toBe("new_lead"); // Still unchanged!
});
