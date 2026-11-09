import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { MigrationEngine } from "@/features/migration/engine/migration-engine";
import {
  createCleanLegacyDataset,
  createFinancialMismatchDataset,
} from "@/features/migration/fixtures/representative-datasets";
import type { MigrationConfiguration } from "@/features/migration/types";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: any;

let studioId: string;
let adminUserId: string;
let masterUserId: string;
let masterId: string;
let serviceId: string;

let sourceSystem: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  sourceSystem = `legacy_crm_${randomUUID()}`;

  // Insert studio
  const [studio] = await db
    .insert(s.studios)
    .values(studioFixture())
    .returning();
  studioId = studio.id;

  // Insert users
  adminUserId = randomUUID();
  masterUserId = randomUUID();

  await db.insert(s.user).values([
    { id: adminUserId, name: "Studio Admin", email: `${adminUserId}@example.test`, role: "SUPER_ADMIN", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    { id: masterUserId, name: "Anna Master", email: `${masterUserId}@example.test`, role: "MASTER", emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
  ]);

  // Roles map
  const roles = await db.select().from(s.roles);
  const adminRoleId = roles.find((r: any) => r.code === "OWNER" || r.code === "STUDIO_ADMIN")!.id;
  const masterRoleId = roles.find((r: any) => r.code === "MASTER")!.id;

  await db.insert(s.studioMembers).values([
    { studioId, userId: adminUserId, roleId: adminRoleId, isActive: true },
    { studioId, userId: masterUserId, roleId: masterRoleId, isActive: true },
  ]);

  // Master profile
  const [master] = await db
    .insert(s.masters)
    .values({
      studioId,
      userId: masterUserId,
      displayName: "Anna Master",
      isActive: true,
    })
    .returning();
  masterId = master.id;

  // Service
  const [service] = await db
    .insert(s.services)
    .values({
      studioId,
      name: "Brows PMU Initial",
      category: "brows",
      procedureType: "brows",
      priceCents: 35000,
      durationMinutes: 120,
      isActive: true,
    })
    .returning();
  serviceId = service.id;
});

afterAll(async () => {
  await database?.close();
});

describe("Phase 19 Migration Pipeline Integration Tests", () => {
  it("Dry-run execution performs full validation without writing database records", async () => {
    const dataset = { ...createCleanLegacyDataset(), sourceSystem };

    const config: MigrationConfiguration = {
      sourceSystem,
      defaultTimezone: "Europe/Rome",
      studioId,
      actorUserId: adminUserId,
      staffMappings: {
        "staff-1": { legacyStaffIdOrName: "staff-1", targetMasterId: masterId, status: "MAPPED" },
        "Anna Master": { legacyStaffIdOrName: "Anna Master", targetMasterId: masterId, status: "MAPPED" },
      },
      serviceMappings: {
        "srv-brows": { legacyServiceNameOrCode: "srv-brows", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "Brows PMU Initial": { legacyServiceNameOrCode: "Brows PMU Initial", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "srv-lips": { legacyServiceNameOrCode: "srv-lips", targetServiceId: serviceId, catalogCode: "lips_pmu_primary", status: "MAPPED" },
        "srv-remover": { legacyServiceNameOrCode: "srv-remover", targetServiceId: serviceId, catalogCode: "remover_session", status: "MAPPED" },
      },
      currency: "EUR",
      dryRun: true,
    };

    const engine = new MigrationEngine();
    const summary = await engine.dryRun(dataset, config);

    expect(summary.status).toBe("DRY_RUN_PASSED");
    expect(summary.cutoverReadiness.ready).toBe(true);

    // Verify 0 records were inserted into DB
    const clientRows = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    expect(clientRows).toHaveLength(0);

    const cycleRows = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId, studioId));
    expect(cycleRows).toHaveLength(0);
  });

  it("Apply mode accurately imports clients, treatment cycles, appointments, and ledger entries", async () => {
    const dataset = { ...createCleanLegacyDataset(), sourceSystem };

    const config: MigrationConfiguration = {
      sourceSystem,
      defaultTimezone: "Europe/Rome",
      studioId,
      actorUserId: adminUserId,
      staffMappings: {
        "staff-1": { legacyStaffIdOrName: "staff-1", targetMasterId: masterId, status: "MAPPED" },
        "Anna Master": { legacyStaffIdOrName: "Anna Master", targetMasterId: masterId, status: "MAPPED" },
      },
      serviceMappings: {
        "srv-brows": { legacyServiceNameOrCode: "srv-brows", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "Brows PMU Initial": { legacyServiceNameOrCode: "Brows PMU Initial", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "srv-lips": { legacyServiceNameOrCode: "srv-lips", targetServiceId: serviceId, catalogCode: "lips_pmu_primary", status: "MAPPED" },
        "srv-remover": { legacyServiceNameOrCode: "srv-remover", targetServiceId: serviceId, catalogCode: "remover_session", status: "MAPPED" },
      },
      currency: "EUR",
      dryRun: false,
    };

    const engine = new MigrationEngine();
    const summary = await engine.apply(dataset, config, db);

    expect(summary.status).toBe("APPLIED_SUCCESSFULLY");

    // Verify Clients in DB
    const clientRows = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    expect(clientRows.length).toBe(3);

    const giulia = clientRows.find((c: any) => c.firstName === "Giulia");
    expect(giulia).toBeDefined();
    expect(giulia.phone).toBe("+393331112233");
    expect(giulia.clientStatus).toBe("new_lead"); // Canonical DB value

    // Verify Treatment Cycles in DB (including Total Face package expansion into 3 sibling cycles)
    const cycleRows = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId, studioId));
    expect(cycleRows.length).toBe(5); // 1 brows + 1 remover + 3 Total Face sibling cycles

    // Verify Appointments
    const appRows = await db.select().from(s.appointments).where(eq(s.appointments.studioId, studioId));
    expect(appRows.length).toBe(1);
    expect(appRows[0].status).toBe("completed");

    // Verify Financial Ledger
    const ledgerRows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.studioId, studioId));
    expect(ledgerRows.length).toBe(4);

    // Verify Audit Logs
    const auditRows = await db.select().from(s.auditLogs).where(eq(s.auditLogs.studioId, studioId));
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows.some((a: any) => a.action === "client_created")).toBe(true);
  });

  it("Idempotency: Re-running exact same migration apply produces 0 duplicate records", async () => {
    const dataset = { ...createCleanLegacyDataset(), sourceSystem };

    const config: MigrationConfiguration = {
      sourceSystem,
      defaultTimezone: "Europe/Rome",
      studioId,
      actorUserId: adminUserId,
      staffMappings: {
        "staff-1": { legacyStaffIdOrName: "staff-1", targetMasterId: masterId, status: "MAPPED" },
      },
      serviceMappings: {
        "srv-brows": { legacyServiceNameOrCode: "srv-brows", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "Brows PMU Initial": { legacyServiceNameOrCode: "Brows PMU Initial", targetServiceId: serviceId, catalogCode: "brows_pmu_primary", status: "MAPPED" },
        "srv-lips": { legacyServiceNameOrCode: "srv-lips", targetServiceId: serviceId, catalogCode: "lips_pmu_primary", status: "MAPPED" },
        "srv-remover": { legacyServiceNameOrCode: "srv-remover", targetServiceId: serviceId, catalogCode: "remover_session", status: "MAPPED" },
      },
      currency: "EUR",
      dryRun: false,
    };

    const initialClients = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    const initialCycles = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId, studioId));
    const initialApps = await db.select().from(s.appointments).where(eq(s.appointments.studioId, studioId));
    const initialLedger = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.studioId, studioId));

    const engine = new MigrationEngine();
    const secondRun = await engine.apply(dataset, config, db);

    expect(secondRun.status).toBe("APPLIED_SUCCESSFULLY");

    const finalClients = await db.select().from(s.clients).where(eq(s.clients.studioId, studioId));
    const finalCycles = await db.select().from(s.treatmentCycles).where(eq(s.treatmentCycles.studioId, studioId));
    const finalApps = await db.select().from(s.appointments).where(eq(s.appointments.studioId, studioId));
    const finalLedger = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.studioId, studioId));

    expect(finalClients.length).toBe(initialClients.length);
    expect(finalCycles.length).toBe(initialCycles.length);
    expect(finalApps.length).toBe(initialApps.length);
    expect(finalLedger.length).toBe(initialLedger.length);
  });

  it("Production Safety: Refuses execution on production-like database target without confirmProduction flag", async () => {
    const dataset = createCleanLegacyDataset();

    const config: MigrationConfiguration = {
      sourceSystem: "legacy_crm_studio_rome",
      defaultTimezone: "Europe/Rome",
      studioId,
      actorUserId: adminUserId,
      staffMappings: {},
      serviceMappings: {},
      currency: "EUR",
      dryRun: false,
      confirmProduction: false,
    };

    const engine = new MigrationEngine();
    const prodUrl = "postgresql://pmu_admin:Secret@ep-prod-db.neon.tech/pmu_prod";

    await expect(engine.apply(dataset, config, db, prodUrl)).rejects.toThrow(/PRODUCTION SAFETY REFUSAL/);
  });

  it("Blocker Prevention: Refuses apply when dataset has blocking errors", async () => {
    const dataset = createFinancialMismatchDataset();

    const config: MigrationConfiguration = {
      sourceSystem: "legacy_crm_studio_rome",
      defaultTimezone: "Europe/Rome",
      studioId,
      actorUserId: adminUserId,
      staffMappings: {},
      serviceMappings: {},
      currency: "EUR",
      dryRun: false,
    };

    const engine = new MigrationEngine();
    const result = await engine.apply(dataset, config, db);

    expect(result.status).toBe("APPLY_FAILED");
    expect(result.cutoverReadiness.ready).toBe(false);
  });
});
