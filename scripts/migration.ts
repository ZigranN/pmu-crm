#!/usr/bin/env node
/**
 * JUNIE PRO — PHASE 19
 * Production Data Migration, Legacy Import, Reconciliation & Cutover Preparation CLI
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseSourceDataset } from "../src/features/migration/staging/parser";
import { MigrationEngine } from "../src/features/migration/engine/migration-engine";
import { createCleanLegacyDataset } from "../src/features/migration/fixtures/representative-datasets";
import type {
  LegacySourceDataset,
  MigrationConfiguration,
  StaffMappingRule,
  ServiceMappingRule,
} from "../src/features/migration/types";

export function parseCliArgs(args: string[] = process.argv.slice(2)) {
  const options = {
    mode: "dry-run" as "dry-run" | "apply",
    sourceFile: null as string | null,
    studioId: process.env.STUDIO_ID || "00000000-0000-0000-0000-000000000001",
    actorUserId: process.env.USER_ID || "00000000-0000-0000-0000-000000000002",
    confirmProduction: false,
    outputFile: null as string | null,
    timezone: "Europe/Rome",
    currency: "EUR",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      options.mode = "dry-run";
    } else if (arg === "--apply") {
      options.mode = "apply";
    } else if (arg === "--source" || arg === "-s") {
      options.sourceFile = args[++i];
    } else if (arg === "--studio-id") {
      options.studioId = args[++i];
    } else if (arg === "--confirm-production") {
      options.confirmProduction = true;
    } else if (arg === "--output" || arg === "-o") {
      options.outputFile = args[++i];
    } else if (arg === "--timezone") {
      options.timezone = args[++i];
    } else if (arg === "--currency") {
      options.currency = args[++i];
    }
  }

  return options;
}

export async function runMigrationCli(args: string[] = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  console.log("===============================================================================");
  console.log("JUNIE PRO — PHASE 19: PRODUCTION DATA MIGRATION & CUTOVER PIPELINE");
  console.log("===============================================================================");

  let dataset: LegacySourceDataset;

  if (options.sourceFile && existsSync(options.sourceFile)) {
    console.log(`[SOURCE] Loading migration dataset from file: ${options.sourceFile}`);
    const raw = readFileSync(options.sourceFile, "utf-8");
    const parsed = parseSourceDataset(raw);
    dataset = parsed.dataset;
  } else {
    console.log("PRODUCTION SOURCE DATA NOT AVAILABLE IN CURRENT ENVIRONMENT");
    console.log("[SOURCE] Initializing representative canonical fixtures for validation & dry-run...");
    dataset = createCleanLegacyDataset();
  }

  const staffMappings: Record<string, StaffMappingRule> = {
    "staff-1": { legacyStaffIdOrName: "staff-1", targetMasterId: "master-uuid-1", status: "MAPPED" },
    "Anna Master": { legacyStaffIdOrName: "Anna Master", targetMasterId: "master-uuid-1", status: "MAPPED" },
    "staff-2": { legacyStaffIdOrName: "staff-2", targetUserId: options.actorUserId, status: "MAPPED" },
    "Elena Assistant": { legacyStaffIdOrName: "Elena Assistant", targetUserId: options.actorUserId, status: "MAPPED" },
  };

  const serviceMappings: Record<string, ServiceMappingRule> = {
    "srv-brows": { legacyServiceNameOrCode: "srv-brows", catalogCode: "brows_pmu_primary", status: "MAPPED" },
    "Brows PMU Initial": { legacyServiceNameOrCode: "Brows PMU Initial", catalogCode: "brows_pmu_primary", status: "MAPPED" },
    "srv-lips": { legacyServiceNameOrCode: "srv-lips", catalogCode: "lips_pmu_primary", status: "MAPPED" },
    "Lips PMU Initial": { legacyServiceNameOrCode: "Lips PMU Initial", catalogCode: "lips_pmu_primary", status: "MAPPED" },
    "srv-remover": { legacyServiceNameOrCode: "srv-remover", catalogCode: "remover_session", status: "MAPPED" },
    "Laser Remover Session": { legacyServiceNameOrCode: "Laser Remover Session", catalogCode: "remover_session", status: "MAPPED" },
  };

  const config: MigrationConfiguration = {
    sourceSystem: dataset.sourceSystem || "legacy_crm",
    defaultTimezone: options.timezone,
    studioId: options.studioId,
    actorUserId: options.actorUserId,
    staffMappings,
    serviceMappings,
    currency: options.currency,
    dryRun: options.mode === "dry-run",
    confirmProduction: options.confirmProduction,
  };

  const engine = new MigrationEngine();

  let summary;
  if (options.mode === "dry-run") {
    console.log("\n[EXECUTION] Running Migration Pipeline in DRY-RUN mode (0 writes to DB)...");
    summary = await engine.dryRun(dataset, config);
  } else {
    console.log("\n[EXECUTION] Running Migration Pipeline in APPLY mode...");
    const { db } = await import("../src/db");
    summary = await engine.apply(dataset, config, db, process.env.DATABASE_URL);
  }

  console.log("\n-------------------------------------------------------------------------------");
  console.log(`RUN ID:         ${summary.runId}`);
  console.log(`MODE:           ${summary.mode}`);
  console.log(`STATUS:         ${summary.status}`);
  console.log(`INPUT CHECKSUM: ${summary.inputChecksum}`);
  console.log(`STARTED AT:     ${summary.startedAt}`);
  console.log(`COMPLETED AT:   ${summary.completedAt}`);
  console.log("-------------------------------------------------------------------------------");

  console.log("\n[ENTITY COUNTS]");
  for (const [entity, counts] of Object.entries(summary.counts)) {
    console.log(`  - ${entity.padEnd(14)}: Source: ${counts.sourceCount.toString().padStart(3)}, Mapped: ${counts.mappedCount.toString().padStart(3)}, Migrated: ${counts.migratedCount.toString().padStart(3)}, Rejected: ${counts.rejectedCount.toString().padStart(3)}`);
  }

  console.log("\n[FINANCIAL RECONCILIATION]");
  const fin = summary.financialReconciliation;
  console.log(`  - Expected Legacy Balance: ${fin.studioTotalLegacyExpectedMinor / 100} ${fin.currency}`);
  console.log(`  - Imported Ledger Balance: ${fin.studioTotalImportedLedgerMinor / 100} ${fin.currency}`);
  console.log(`  - Difference:              ${fin.studioDifferenceMinor / 100} ${fin.currency}`);
  console.log(`  - Status:                  ${fin.isReconciled ? "RECONCILED (diff = 0)" : "UNRECONCILED MISMATCH (BLOCKER)"}`);

  console.log("\n[FINDINGS SUMMARY]");
  console.log(`  - BLOCKERS: ${summary.findingCounts.BLOCKER}`);
  console.log(`  - ERRORS:   ${summary.findingCounts.ERROR}`);
  console.log(`  - WARNINGS: ${summary.findingCounts.WARNING}`);
  console.log(`  - INFO:     ${summary.findingCounts.INFO}`);

  if (summary.findings.length > 0) {
    console.log("\n[KEY FINDINGS]");
    for (const f of summary.findings.slice(0, 15)) {
      console.log(`  [${f.severity}] (${f.code}) ${f.message}`);
    }
  }

  console.log("\n===============================================================================");
  console.log(`CUTOVER DECISION: ${summary.cutoverReadiness.ready ? "READY FOR CUTOVER" : "CUTOVER BLOCKED"}`);
  if (!summary.cutoverReadiness.ready) {
    console.log("BLOCKERS:");
    for (const b of summary.cutoverReadiness.blockers) {
      console.log(`  ! ${b}`);
    }
  }
  console.log("===============================================================================");

  if (options.outputFile) {
    try {
      writeFileSync(options.outputFile, JSON.stringify(summary, null, 2), "utf-8");
      console.log(`\nReport artifact saved to: ${options.outputFile}`);
    } catch (err: any) {
      console.warn(`Could not write report artifact: ${err.message}`);
    }
  }

  return summary;
}

// Execute directly if run as CLI script
if (process.argv[1]?.includes("migration.ts")) {
  runMigrationCli().catch((err) => {
    console.error("\n[FATAL] Migration execution error:", err.message);
    process.exit(1);
  });
}
