#!/usr/bin/env node
/**
 * Phase 18 — PostgreSQL Logical Backup Automation Script
 *
 * Requirements:
 * - Reads DB URL securely from arguments or environment (DATABASE_URL / TEST_DATABASE_URL).
 * - Creates timestamped, custom-format (-Fc) pg_dump backup.
 * - Fails loudly and exits with non-zero code on error.
 * - Calculates and emits SHA-256 checksum file alongside the artifact.
 * - Prints safe, sanitized operational metadata (never credentials).
 * - Refuses to silently overwrite existing backup without explicit flag.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    databaseUrl: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
    outputPath: null,
    overwrite: false,
    verbose: false,
    noChecksum: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--database-url" || arg === "-d") {
      options.databaseUrl = argv[++i];
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = argv[++i];
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--no-checksum") {
      options.noChecksum = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/backup-postgres.mjs [options]

Options:
  -d, --database-url <url>   PostgreSQL connection string (defaults to DATABASE_URL / TEST_DATABASE_URL)
  -o, --output <path>        Output file path (defaults to backups/postgres/pmu-backup-<timestamp>.dump)
  --overwrite                Overwrite target file if it already exists
  --no-checksum              Do not write .sha256 checksum file
  -v, --verbose              Enable verbose logging
  -h, --help                 Display this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export async function executeBackup(options = {}) {
  const startTime = Date.now();
  const dbUrl = options.databaseUrl || process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

  if (!dbUrl) {
    const err = new Error("PostgreSQL database URL is required (provide via --database-url or DATABASE_URL/TEST_DATABASE_URL env)");
    console.error(`[BACKUP_ERROR] ${err.message}`);
    throw err;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(dbUrl);
  } catch (e) {
    const err = new Error(`Invalid PostgreSQL connection URL format: ${e.message}`);
    console.error(`[BACKUP_ERROR] ${err.message}`);
    throw err;
  }

  const safeTarget = sanitizeDatabaseUrl(dbUrl);
  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, "-");

  const outputPath = options.outputPath
    ? resolve(process.cwd(), options.outputPath)
    : resolve(process.cwd(), "backups", "postgres", `pmu-backup-${timestampStr}.dump`);

  if (existsSync(outputPath) && !options.overwrite) {
    const err = new Error(`Backup file already exists at ${outputPath}. Refusing to overwrite without --overwrite flag.`);
    console.error(`[BACKUP_ERROR] ${err.message}`);
    throw err;
  }

  mkdirSync(dirname(outputPath), { recursive: true });

  const env = { ...process.env };
  if (parsedUrl.password) {
    env.PGPASSWORD = decodeURIComponent(parsedUrl.password);
  }

  const pgDumpArgs = [
    "--format=c", // Custom archive format (compressed, supports pg_restore)
    "--blobs",
    "--no-owner",
    "--no-privileges",
    `--dbname=${dbUrl}`,
    `--file=${outputPath}`,
  ];

  if (options.verbose) {
    console.log(`[BACKUP_START] Target: ${safeTarget}`);
    console.log(`[BACKUP_START] Destination: ${outputPath}`);
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("pg_dump", pgDumpArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      rejectPromise(new Error(`Failed to launch pg_dump executable: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        // Redact any possible credentials in stderr
        const safeStderr = stderr.replace(/password=[^\s]+/gi, "password=***");
        rejectPromise(new Error(`pg_dump failed with exit code ${code}: ${safeStderr.trim()}`));
      } else {
        resolvePromise();
      }
    });
  });

  let sha256 = null;
  if (!options.noChecksum) {
    sha256 = await computeFileSha256(outputPath);
    const checksumPath = `${outputPath}.sha256`;
    writeFileSync(checksumPath, `${sha256}  ${outputPath}\n`, "utf8");
  }

  const durationMs = Date.now() - startTime;
  const resultMetadata = {
    operation: "backup",
    status: "SUCCESS",
    timestamp: now.toISOString(),
    target: safeTarget,
    artifactPath: outputPath,
    checksumSha256: sha256,
    durationMs,
  };

  console.log(JSON.stringify(resultMetadata, null, 2));
  return resultMetadata;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs();
  executeBackup(options).catch((err) => {
    console.error(`[BACKUP_FATAL] ${err.message}`);
    process.exit(1);
  });
}
