import { v2 as cloudinary } from "cloudinary";
import { db } from "@/db";
import { media } from "@/db/schema";
import { asc } from "drizzle-orm";
import "dotenv/config";

export type MigrationMode = "dry-run" | "execute";
export type ResourceType = "image" | "raw";

export type ProviderState =
  | "UPLOAD_EXISTS"
  | "AUTHENTICATED_EXISTS"
  | "BOTH_EXIST"
  | "NEITHER_EXISTS"
  | "LOOKUP_FAILED";

export type PlannedAction =
  | "WOULD_MIGRATE"
  | "MIGRATED"
  | "ALREADY_AUTHENTICATED"
  | "PROVIDER_CONFLICT"
  | "MISSING_PROVIDER_ASSET"
  | "UNCLASSIFIABLE_RESOURCE_TYPE"
  | "LOOKUP_FAILED"
  | "MIGRATION_FAILED"
  | "VERIFICATION_FAILED"
  | "SKIPPED_NON_SENSITIVE";

export interface RowEvidence {
  mediaId: string;
  studioId: string;
  mediaType: string;
  publicId: string | null;
  resourceType: ResourceType | null;
  providerState: ProviderState | "UNPROBED";
  plannedAction: PlannedAction;
  archived: boolean;
  details?: string;
}

export interface ReconciliationReport {
  mode: MigrationMode;
  candidate: number;
  active_candidates: number;
  archived_candidates: number;
  would_migrate: number;
  migrated: number;
  already_authenticated: number;
  provider_conflict: number;
  missing_provider_asset: number;
  unclassifiable_resource_type: number;
  lookup_failed: number;
  migration_failed: number;
  verification_failed: number;
  skipped_non_sensitive: number;
  rows: RowEvidence[];
}

export interface ParsedCliArgs {
  mode: MigrationMode;
  confirm?: string;
  help?: boolean;
}

export const SENSITIVE_MEDIA_TYPES = new Set<string>([
  "before",
  "after",
  "healing_day_7",
  "healing_day_30",
  "correction",
  "refresh",
  "consent",
  "portfolio",
  "document",
  "other",
]);

export function isSensitiveMediaType(type: string): boolean {
  return SENSITIVE_MEDIA_TYPES.has(type);
}

export function deriveResourceType(url: string | null | undefined): ResourceType | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const lower = url.toLowerCase();

  if (lower.includes("/image/upload/") || lower.includes("/image/authenticated/")) {
    return "image";
  }
  if (lower.includes("/raw/upload/") || lower.includes("/raw/authenticated/")) {
    return "raw";
  }
  if (lower.includes("/image/")) {
    return "image";
  }
  if (lower.includes("/raw/")) {
    return "raw";
  }

  // Extension-based fallback derivation
  if (lower.endsWith(".pdf")) {
    return "raw";
  }
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".heic") ||
    lower.endsWith(".heif")
  ) {
    return "image";
  }

  return null;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  let isExecute = false;
  let confirm: string | undefined;
  let help = false;

  for (const arg of args) {
    if (arg === "--execute") {
      isExecute = true;
    } else if (arg.startsWith("--confirm=")) {
      confirm = arg.slice("--confirm=".length);
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    }
  }

  if (isExecute) {
    return { mode: "execute", confirm, help };
  }
  return { mode: "dry-run", confirm, help };
}

export function validateExecutionGuard(args: ParsedCliArgs): void {
  if (args.mode === "execute") {
    if (args.confirm !== "authenticated-migration") {
      throw new Error(
        "Execution guard failed: --execute requires explicit confirmation flag --confirm=authenticated-migration"
      );
    }
  }
}

export interface CloudinaryApi {
  resource: (
    publicId: string,
    options: { resource_type: string; type: string }
  ) => Promise<any>;
}

export interface CloudinaryUploader {
  rename: (
    fromPublicId: string,
    toPublicId: string,
    options: {
      resource_type: string;
      type: string;
      to_type: string;
      invalidate: boolean;
      overwrite: boolean;
    }
  ) => Promise<any>;
  destroy: (
    publicId: string,
    options?: { resource_type?: string; type?: string }
  ) => Promise<any>;
}

export interface CloudinaryClient {
  api: CloudinaryApi;
  uploader: CloudinaryUploader;
}

export interface CandidateMediaRecord {
  id: string;
  studioId: string;
  type: string;
  url: string;
  publicId: string | null;
  deletedAt: Date | null;
}

export interface MigrationDatabase {
  fetchCandidateMediaRows: () => Promise<CandidateMediaRecord[]>;
}

export interface ProbeResult {
  state: ProviderState;
  uploadDetails?: any;
  authenticatedDetails?: any;
  error?: string;
}

export async function probeProviderAsset(
  publicId: string,
  resourceType: ResourceType,
  api: CloudinaryApi
): Promise<ProbeResult> {
  let uploadExists = false;
  let authenticatedExists = false;
  let uploadDetails: any = null;
  let authenticatedDetails: any = null;

  // Probe 1: Check upload delivery bucket
  try {
    const res = await api.resource(publicId, {
      resource_type: resourceType,
      type: "upload",
    });
    if (res && res.public_id === publicId) {
      uploadExists = true;
      uploadDetails = res;
    }
  } catch (err: any) {
    const httpCode = err?.error?.http_code ?? err?.http_code ?? err?.status;
    if (httpCode !== 404) {
      return {
        state: "LOOKUP_FAILED",
        error: `Upload probe failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Probe 2: Check authenticated delivery bucket
  try {
    const res = await api.resource(publicId, {
      resource_type: resourceType,
      type: "authenticated",
    });
    if (res && res.public_id === publicId) {
      authenticatedExists = true;
      authenticatedDetails = res;
    }
  } catch (err: any) {
    const httpCode = err?.error?.http_code ?? err?.http_code ?? err?.status;
    if (httpCode !== 404) {
      return {
        state: "LOOKUP_FAILED",
        error: `Authenticated probe failed: ${err?.message || String(err)}`,
      };
    }
  }

  if (uploadExists && !authenticatedExists) {
    return { state: "UPLOAD_EXISTS", uploadDetails };
  }
  if (!uploadExists && authenticatedExists) {
    return { state: "AUTHENTICATED_EXISTS", authenticatedDetails };
  }
  if (uploadExists && authenticatedExists) {
    return { state: "BOTH_EXIST", uploadDetails, authenticatedDetails };
  }
  return { state: "NEITHER_EXISTS" };
}

export interface RunMigrationOptions {
  mode: MigrationMode;
  confirm?: string;
  silent?: boolean;
}

export interface RunMigrationDependencies {
  db?: MigrationDatabase;
  cloudinary?: CloudinaryClient;
}

export async function runMigration(
  options: RunMigrationOptions,
  deps?: RunMigrationDependencies
): Promise<ReconciliationReport> {
  validateExecutionGuard({
    mode: options.mode,
    confirm: options.confirm,
  });

  const database: MigrationDatabase = deps?.db || {
    fetchCandidateMediaRows: async () => {
      return await db
        .select({
          id: media.id,
          studioId: media.studioId,
          type: media.type,
          url: media.url,
          publicId: media.publicId,
          deletedAt: media.deletedAt,
        })
        .from(media)
        .orderBy(asc(media.id));
    },
  };

  const cloudClient: CloudinaryClient = deps?.cloudinary || {
    api: cloudinary.api,
    uploader: cloudinary.uploader,
  };

  const rows = await database.fetchCandidateMediaRows();

  const report: ReconciliationReport = {
    mode: options.mode,
    candidate: 0,
    active_candidates: 0,
    archived_candidates: 0,
    would_migrate: 0,
    migrated: 0,
    already_authenticated: 0,
    provider_conflict: 0,
    missing_provider_asset: 0,
    unclassifiable_resource_type: 0,
    lookup_failed: 0,
    migration_failed: 0,
    verification_failed: 0,
    skipped_non_sensitive: 0,
    rows: [],
  };

  if (!options.silent) {
    console.log(`\n=============================================================`);
    console.log(`Starting Cloudinary Authenticated Migration Utility`);
    console.log(`Mode: ${options.mode.toUpperCase()}`);
    console.log(`Concurrency: SERIAL`);
    console.log(`Total database rows fetched: ${rows.length}`);
    console.log(`=============================================================\n`);
  }

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const isArchived = row.deletedAt !== null;

    // Filter 1: Check sensitive predicate
    if (!isSensitiveMediaType(row.type)) {
      report.skipped_non_sensitive++;
      const evidence: RowEvidence = {
        mediaId: row.id,
        studioId: row.studioId,
        mediaType: row.type,
        publicId: row.publicId,
        resourceType: null,
        providerState: "UNPROBED",
        plannedAction: "SKIPPED_NON_SENSITIVE",
        archived: isArchived,
      };
      report.rows.push(evidence);
      if (!options.silent) {
        console.log(
          `[${idx + 1}/${rows.length}] ID: ${row.id} | Studio: ${row.studioId} | Type: ${row.type} -> SKIPPED_NON_SENSITIVE`
        );
      }
      continue;
    }

    // Filter 2: Non-null publicId check
    if (!row.publicId) {
      report.skipped_non_sensitive++;
      const evidence: RowEvidence = {
        mediaId: row.id,
        studioId: row.studioId,
        mediaType: row.type,
        publicId: null,
        resourceType: null,
        providerState: "UNPROBED",
        plannedAction: "SKIPPED_NON_SENSITIVE",
        archived: isArchived,
        details: "Missing publicId",
      };
      report.rows.push(evidence);
      if (!options.silent) {
        console.log(
          `[${idx + 1}/${rows.length}] ID: ${row.id} | Studio: ${row.studioId} | Type: ${row.type} -> SKIPPED_NON_SENSITIVE (no publicId)`
        );
      }
      continue;
    }

    report.candidate++;
    if (isArchived) {
      report.archived_candidates++;
    } else {
      report.active_candidates++;
    }

    // Filter 3: Derive resource_type fail-closed
    const resourceType = deriveResourceType(row.url);
    if (!resourceType) {
      report.unclassifiable_resource_type++;
      const evidence: RowEvidence = {
        mediaId: row.id,
        studioId: row.studioId,
        mediaType: row.type,
        publicId: row.publicId,
        resourceType: null,
        providerState: "UNPROBED",
        plannedAction: "UNCLASSIFIABLE_RESOURCE_TYPE",
        archived: isArchived,
        details: `Unclassifiable URL: ${row.url}`,
      };
      report.rows.push(evidence);
      if (!options.silent) {
        console.log(
          `[${idx + 1}/${rows.length}] ID: ${row.id} | PublicId: ${row.publicId} -> UNCLASSIFIABLE_RESOURCE_TYPE`
        );
      }
      continue;
    }

    // Probe provider state
    const probe = await probeProviderAsset(row.publicId, resourceType, cloudClient.api);

    let action: PlannedAction;
    let details: string | undefined;

    switch (probe.state) {
      case "LOOKUP_FAILED": {
        report.lookup_failed++;
        action = "LOOKUP_FAILED";
        details = probe.error;
        break;
      }
      case "BOTH_EXIST": {
        report.provider_conflict++;
        action = "PROVIDER_CONFLICT";
        details = "Both upload and authenticated assets exist on provider; halting mutation for manual review.";
        break;
      }
      case "NEITHER_EXISTS": {
        report.missing_provider_asset++;
        action = "MISSING_PROVIDER_ASSET";
        details = "Asset not found in upload or authenticated delivery buckets.";
        break;
      }
      case "AUTHENTICATED_EXISTS": {
        report.already_authenticated++;
        action = "ALREADY_AUTHENTICATED";
        break;
      }
      case "UPLOAD_EXISTS": {
        if (options.mode === "dry-run") {
          report.would_migrate++;
          action = "WOULD_MIGRATE";
        } else {
          // LIVE EXECUTION BRANCH
          try {
            const renameRes = await cloudClient.uploader.rename(
              row.publicId,
              row.publicId,
              {
                resource_type: resourceType,
                type: "upload",
                to_type: "authenticated",
                invalidate: true,
                overwrite: false,
              }
            );

            // Post-rename two-point verification
            const postProbe = await probeProviderAsset(
              row.publicId,
              resourceType,
              cloudClient.api
            );

            const verified =
              postProbe.state === "AUTHENTICATED_EXISTS" &&
              renameRes?.public_id === row.publicId;

            if (verified) {
              report.migrated++;
              action = "MIGRATED";
            } else {
              report.verification_failed++;
              action = "VERIFICATION_FAILED";
              details = `Post-rename probe verification failed. Expected AUTHENTICATED_EXISTS, got: ${postProbe.state}`;
            }
          } catch (renameErr: any) {
            report.migration_failed++;
            action = "MIGRATION_FAILED";
            details = `Rename failed: ${renameErr?.message || String(renameErr)}`;
          }
        }
        break;
      }
    }

    const evidence: RowEvidence = {
      mediaId: row.id,
      studioId: row.studioId,
      mediaType: row.type,
      publicId: row.publicId,
      resourceType,
      providerState: probe.state,
      plannedAction: action,
      archived: isArchived,
      details,
    };
    report.rows.push(evidence);

    if (!options.silent) {
      console.log(
        `[${idx + 1}/${rows.length}] ID: ${row.id} | Studio: ${row.studioId} | Type: ${row.type} | PublicId: ${row.publicId} | Resource: ${resourceType} | ProviderState: ${probe.state} -> Action: ${action}`
      );
    }
  }

  if (!options.silent) {
    console.log(`\n=============================================================`);
    console.log(`Cloudinary Authenticated Migration Summary`);
    console.log(`Mode:                          ${report.mode.toUpperCase()}`);
    console.log(`Total Candidates:              ${report.candidate}`);
    console.log(`  - Active:                    ${report.active_candidates}`);
    console.log(`  - Archived:                  ${report.archived_candidates}`);
    console.log(`Would Migrate:                 ${report.would_migrate}`);
    console.log(`Migrated:                      ${report.migrated}`);
    console.log(`Already Authenticated:         ${report.already_authenticated}`);
    console.log(`Provider Conflicts:            ${report.provider_conflict}`);
    console.log(`Missing Provider Assets:       ${report.missing_provider_asset}`);
    console.log(`Unclassifiable Resource Types: ${report.unclassifiable_resource_type}`);
    console.log(`Lookup Failures:               ${report.lookup_failed}`);
    console.log(`Migration Failures:            ${report.migration_failed}`);
    console.log(`Verification Failures:         ${report.verification_failed}`);
    console.log(`Skipped Non-Sensitive:         ${report.skipped_non_sensitive}`);
    console.log(`=============================================================\n`);
  }

  return report;
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith("migrate-cloudinary-authenticated.ts") || process.argv[1].endsWith("migrate-cloudinary-authenticated.js"))) {
  const parsedArgs = parseCliArgs(process.argv.slice(2));

  if (parsedArgs.help) {
    console.log(`
Usage:
  npm run cloudinary:migrate-authenticated -- [--dry-run]
  npm run cloudinary:migrate-authenticated -- --execute --confirm=authenticated-migration

Options:
  --dry-run        Default safe mode. Probes provider state and generates report with 0 mutations.
  --execute        Executes live provider rename upload -> authenticated.
  --confirm=...    Required confirmation token: "authenticated-migration" when using --execute.
  -h, --help       Show this help message.
`);
    process.exit(0);
  }

  runMigration({
    mode: parsedArgs.mode,
    confirm: parsedArgs.confirm,
  })
    .then((report) => {
      if (report.lookup_failed > 0 || report.migration_failed > 0 || report.verification_failed > 0 || report.provider_conflict > 0) {
        console.warn("Migration finished with warnings or exceptions.");
      } else {
        console.log("Migration dry-run/execution completed successfully.");
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration execution failed:", err.message);
      process.exit(1);
    });
}
