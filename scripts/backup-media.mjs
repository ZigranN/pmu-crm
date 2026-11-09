#!/usr/bin/env node
/**
 * Phase 18 — Media Storage Backup & Manifest Script
 *
 * Requirements:
 * - Inspects PostgreSQL database media and cycle consent records.
 * - Categorizes media: signed consent PDFs, procedure evidence, client media,
 *   conversation attachments, privacy exports, temporary uploads.
 * - Distinguishes authoritative records from re-creatable artifacts.
 * - Computes SHA-256 checksums and produces a deterministic JSON manifest.
 * - Copies local files if storage directory is provided.
 * - Never logs secrets or private storage credentials.
 */

import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export function computeSha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function computeFileSha256(filePath) {
  return new Promise((res, rej) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => res(hash.digest("hex")));
    stream.on("error", (err) => rej(err));
  });
}

export function classifyMediaCategory(record) {
  if (record.is_cycle_consent || record.type === "consent") {
    return { category: "signed_consent", isAuthoritative: true };
  }
  if (record.procedure_session_id || record.type === "before" || record.type === "after") {
    return { category: "procedure_evidence", isAuthoritative: true };
  }
  if (record.type === "general" || record.client_id) {
    return { category: "client_media", isAuthoritative: true };
  }
  if (record.type === "privacy_export") {
    return { category: "privacy_export", isAuthoritative: false };
  }
  return { category: "temporary_upload", isAuthoritative: false };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    databaseUrl: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
    storageDir: null,
    outputPath: null,
    manifestOnly: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--database-url" || arg === "-d") {
      options.databaseUrl = argv[++i];
    } else if (arg === "--storage-dir" || arg === "-s") {
      options.storageDir = argv[++i];
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = argv[++i];
    } else if (arg === "--manifest-only") {
      options.manifestOnly = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/backup-media.mjs [options]

Options:
  -d, --database-url <url>   PostgreSQL connection string (defaults to DATABASE_URL / TEST_DATABASE_URL)
  -s, --storage-dir <path>   Local media root storage directory to copy files from
  -o, --output <path>        Output directory or manifest path (defaults to backups/media/)
  --manifest-only            Only generate manifest from DB records, do not copy files
  -v, --verbose              Enable verbose logging
  -h, --help                 Display this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export async function executeMediaBackup(options = {}) {
  const startTime = Date.now();
  const dbUrl = options.databaseUrl || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

  if (!dbUrl) {
    const err = new Error("PostgreSQL database URL is required for media manifest extraction");
    console.error(`[MEDIA_BACKUP_ERROR] ${err.message}`);
    throw err;
  }

  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, "-");
  const baseOutputDir = options.outputPath
    ? resolve(process.cwd(), options.outputPath)
    : resolve(process.cwd(), "backups", "media", `media-backup-${timestampStr}`);

  mkdirSync(baseOutputDir, { recursive: true });

  const sql = postgres(dbUrl, { max: 1 });
  let mediaRecords = [];
  let consentRecords = [];

  try {
    // Check if media table exists
    const [tableExists] = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'media'
      ) as exists;
    `;

    if (tableExists && tableExists.exists) {
      mediaRecords = await sql`
        SELECT 
          m.id,
          m.studio_id,
          m.client_id,
          m.appointment_id,
          m.procedure_session_id,
          m.type,
          m.url,
          m.public_id,
          m.caption,
          m.created_at,
          m.deleted_at,
          EXISTS(SELECT 1 FROM cycle_consents cc WHERE cc.media_id = m.id) as is_cycle_consent
        FROM media m
        ORDER BY m.created_at ASC
      `;
    }

    const [cycleConsentsTableExists] = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'cycle_consents'
      ) as exists;
    `;

    if (cycleConsentsTableExists && cycleConsentsTableExists.exists) {
      consentRecords = await sql`
        SELECT
          cc.id as cycle_consent_id,
          cc.studio_id,
          cc.cycle_id,
          cc.client_id,
          cc.media_id,
          cc.signed_pdf_sha256,
          cc.signature_method,
          cc.signed_at
        FROM cycle_consents cc
        WHERE cc.signed_pdf_sha256 IS NOT NULL
        ORDER BY cc.created_at ASC
      `;
    }
  } finally {
    await sql.end();
  }

  const consentShaMap = new Map();
  for (const c of consentRecords) {
    if (c.media_id && c.signed_pdf_sha256) {
      consentShaMap.set(c.media_id, c.signed_pdf_sha256);
    }
  }

  const manifestItems = [];
  const filesDir = join(baseOutputDir, "files");
  if (!options.manifestOnly && options.storageDir) {
    mkdirSync(filesDir, { recursive: true });
  }

  for (const row of mediaRecords) {
    const { category, isAuthoritative } = classifyMediaCategory(row);
    const expectedSha256 = consentShaMap.get(row.id) || null;

    let sizeBytes = null;
    let computedSha256 = expectedSha256;

    if (options.storageDir) {
      // Check if file exists on local disk storage
      const relativePathCandidate = row.public_id || row.id;
      const candidatePaths = [
        join(options.storageDir, `${row.id}`),
        join(options.storageDir, `${row.id}.pdf`),
        join(options.storageDir, `${row.id}.jpg`),
        join(options.storageDir, `${row.id}.png`),
        join(options.storageDir, `${relativePathCandidate}`),
      ];

      for (const p of candidatePaths) {
        if (existsSync(p)) {
          const stat = statSync(p);
          sizeBytes = stat.size;
          computedSha256 = await computeFileSha256(p);

          if (!options.manifestOnly) {
            const destPath = join(filesDir, `${row.id}_${row.type}`);
            copyFileSync(p, destPath);
          }
          break;
        }
      }
    }

    manifestItems.push({
      mediaId: row.id,
      studioId: row.studio_id,
      clientId: row.client_id,
      appointmentId: row.appointment_id,
      procedureSessionId: row.procedure_session_id,
      type: row.type,
      category,
      isAuthoritative,
      publicId: row.public_id,
      url: row.url,
      sha256: computedSha256,
      sizeBytes,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    });
  }

  const authoritativeCount = manifestItems.filter((i) => i.isAuthoritative).length;
  const reCreatableCount = manifestItems.length - authoritativeCount;

  const manifest = {
    version: "1.0",
    timestamp: now.toISOString(),
    totalRecords: manifestItems.length,
    authoritativeCount,
    reCreatableCount,
    signedConsentsCount: consentRecords.length,
    items: manifestItems,
  };

  const manifestJsonPath = join(baseOutputDir, "media-manifest.json");
  writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2), "utf8");

  const manifestSha256 = await computeFileSha256(manifestJsonPath);
  writeFileSync(`${manifestJsonPath}.sha256`, `${manifestSha256}  media-manifest.json\n`, "utf8");

  const durationMs = Date.now() - startTime;
  const resultMetadata = {
    operation: "media_backup",
    status: "SUCCESS",
    timestamp: now.toISOString(),
    manifestPath: manifestJsonPath,
    manifestSha256,
    totalRecords: manifestItems.length,
    authoritativeCount,
    reCreatableCount,
    durationMs,
  };

  console.log(JSON.stringify(resultMetadata, null, 2));
  return resultMetadata;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs();
  executeMediaBackup(options).catch((err) => {
    console.error(`[MEDIA_BACKUP_FATAL] ${err.message}`);
    process.exit(1);
  });
}
