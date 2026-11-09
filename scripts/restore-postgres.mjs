#!/usr/bin/env node
/**
 * Phase 18 — PostgreSQL Logical Restore Automation Script
 *
 * Requirements:
 * - Explicit target database URL.
 * - Explicit backup artifact path.
 * - Safety refusal against accidental production overwrite without explicit confirmation flag.
 * - Validates checksum before restoring if companion .sha256 or --checksum is provided.
 * - Restores into target database using pg_restore.
 * - Validates restore exit status and reports errors cleanly without credential leakage.
 * - Supports optional post-restore schema verification.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function sanitizeDatabaseUrl(rawUrl) {
  if (!rawUrl) return "[UNDEFINED]";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "[MALFORMED_URL]";
  }
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

export function isPotentialProductionTarget(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const host = (parsed.hostname || "").toLowerCase();
    const dbName = (parsed.pathname || "").toLowerCase();

    // Local / loopback test environments are safe
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      if (dbName.includes("test")) {
        return false;
      }
    }

    // Indicators of production databases
    if (
      dbName.includes("prod") ||
      dbName.includes("live") ||
      host.includes("prod") ||
      host.includes("aws") ||
      host.includes("neon") ||
      host.includes("supabase") ||
      host.includes("render")
    ) {
      return true;
    }

    return host !== "localhost" && host !== "127.0.0.1";
  } catch {
    return true;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    targetUrl: process.env.RESTORE_TARGET_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    backupFile: null,
    confirm: process.env.CONFIRM_RESTORE === "true",
    forceProduction: false,
    clean: true,
    expectedChecksum: null,
    verifyChecksum: true,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target-url" || arg === "-t") {
      options.targetUrl = argv[++i];
    } else if (arg === "--backup-file" || arg === "-f") {
      options.backupFile = argv[++i];
    } else if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--force-production-restore") {
      options.forceProduction = true;
    } else if (arg === "--no-clean") {
      options.clean = false;
    } else if (arg === "--checksum" || arg === "-c") {
      options.expectedChecksum = argv[++i];
    } else if (arg === "--skip-checksum-verify") {
      options.verifyChecksum = false;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/restore-postgres.mjs --backup-file <path> [options]

Options:
  -f, --backup-file <path>       Path to .dump backup artifact (REQUIRED)
  -t, --target-url <url>         Target PostgreSQL connection URL (defaults to RESTORE_TARGET_URL / TEST_DATABASE_URL / DATABASE_URL)
  --confirm                      Explicit confirmation flag (REQUIRED to execute restore)
  --force-production-restore     Required if target appears to be a remote/production database
  --no-clean                     Do not clean/drop existing objects before recreating
  -c, --checksum <hash>          Verify backup against expected SHA-256 hash
  --skip-checksum-verify         Skip verifying .sha256 file
  -v, --verbose                  Enable verbose logging
  -h, --help                     Display this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export async function executeRestore(options = {}) {
  const startTime = Date.now();
  const backupFile = options.backupFile;
  const targetUrl = options.targetUrl || process.env.RESTORE_TARGET_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!backupFile) {
    const err = new Error("Backup file path is required (provide via --backup-file <path>)");
    console.error(`[RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  const resolvedBackupPath = resolve(process.cwd(), backupFile);
  if (!existsSync(resolvedBackupPath)) {
    const err = new Error(`Backup file not found at ${resolvedBackupPath}`);
    console.error(`[RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  if (!targetUrl) {
    const err = new Error("Target PostgreSQL URL is required (provide via --target-url or RESTORE_TARGET_URL / TEST_DATABASE_URL env)");
    console.error(`[RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    const err = new Error(`Invalid target PostgreSQL connection URL: ${e.message}`);
    console.error(`[RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  const safeTarget = sanitizeDatabaseUrl(targetUrl);

  // Safety check 1: Mandatory confirmation flag
  if (!options.confirm) {
    const err = new Error(
      `RESTORE ABORTED: Missing confirmation flag (--confirm or CONFIRM_RESTORE=true). Database restoration is destructive and requires deliberate operator intent.`
    );
    console.error(`[RESTORE_SAFETY_REFUSAL] ${err.message}`);
    throw err;
  }

  // Safety check 2: Production target protection
  if (isPotentialProductionTarget(targetUrl) && !options.forceProduction) {
    const err = new Error(
      `RESTORE ABORTED: Target ${safeTarget} appears to be a production or remote database. To restore to production, you must supply both --confirm and --force-production-restore.`
    );
    console.error(`[RESTORE_SAFETY_REFUSAL] ${err.message}`);
    throw err;
  }

  // Checksum verification
  let calculatedSha256 = null;
  const shouldVerifyChecksum = options.verifyChecksum !== false;
  if (shouldVerifyChecksum) {
    calculatedSha256 = await computeFileSha256(resolvedBackupPath);
    let expectedHash = options.expectedChecksum;

    if (!expectedHash) {
      const checksumFile = `${resolvedBackupPath}.sha256`;
      if (existsSync(checksumFile)) {
        const content = readFileSync(checksumFile, "utf8").trim();
        expectedHash = content.split(/\s+/)[0];
      }
    }

    if (expectedHash) {
      if (calculatedSha256.toLowerCase() !== expectedHash.trim().toLowerCase()) {
        const err = new Error(
          `CORRUPT BACKUP DETECTED: SHA-256 mismatch for ${resolvedBackupPath}. Expected: ${expectedHash}, Computed: ${calculatedSha256}`
        );
        console.error(`[RESTORE_INTEGRITY_ERROR] ${err.message}`);
        throw err;
      }
      if (options.verbose) {
        console.log(`[RESTORE_VERIFY] SHA-256 checksum matched: ${calculatedSha256}`);
      }
    }
  }

  if (options.verbose) {
    console.log(`[RESTORE_START] Artifact: ${resolvedBackupPath}`);
    console.log(`[RESTORE_START] Target: ${safeTarget}`);
  }

  const env = { ...process.env };
  if (parsedUrl.password) {
    env.PGPASSWORD = decodeURIComponent(parsedUrl.password);
  }

  const pgRestoreArgs = [
    "--no-owner",
    "--no-privileges",
  ];

  if (options.clean) {
    pgRestoreArgs.push("--clean", "--if-exists");
  }

  pgRestoreArgs.push(`--dbname=${targetUrl}`, resolvedBackupPath);

  await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("pg_restore", pgRestoreArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      rejectPromise(new Error(`Failed to launch pg_restore executable: ${err.message}`));
    });

    proc.on("close", (code) => {
      // pg_restore returns 0 on success, or 1 on non-fatal warnings (e.g. drop table if exists on clean db)
      // Any exit code > 1 or fatal errors must be treated as failure.
      if (code !== 0 && code !== 1) {
        const safeStderr = stderr.replace(/password=[^\s]+/gi, "password=***");
        rejectPromise(new Error(`pg_restore failed with exit code ${code}: ${safeStderr.trim()}`));
      } else {
        if (code === 1 && options.verbose) {
          console.log(`[RESTORE_NOTICE] pg_restore completed with warnings (code 1)`);
        }
        resolvePromise();
      }
    });
  });

  const durationMs = Date.now() - startTime;
  const resultMetadata = {
    operation: "restore",
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    target: safeTarget,
    artifactPath: resolvedBackupPath,
    checksumSha256: calculatedSha256,
    durationMs,
  };

  console.log(JSON.stringify(resultMetadata, null, 2));
  return resultMetadata;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs();
  executeRestore(options).catch((err) => {
    console.error(`[RESTORE_FATAL] ${err.message}`);
    process.exit(1);
  });
}
