#!/usr/bin/env node
/**
 * Phase 18 — Media Storage Restore & Verification Script
 *
 * Requirements:
 * - Reads and verifies media manifest and SHA-256 checksum.
 * - Restores files into target storage directory with integrity validation.
 * - Compares restored file checksums with manifest hashes.
 * - Verifies database media references and signed consent SHA-256 entries.
 * - Emits structured operational logs.
 */

import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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
    manifestPath: null,
    filesDir: null,
    targetDir: null,
    databaseUrl: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL,
    confirm: process.env.CONFIRM_RESTORE === "true",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" || arg === "-m") {
      options.manifestPath = argv[++i];
    } else if (arg === "--files-dir" || arg === "-f") {
      options.filesDir = argv[++i];
    } else if (arg === "--target-dir" || arg === "-t") {
      options.targetDir = argv[++i];
    } else if (arg === "--database-url" || arg === "-d") {
      options.databaseUrl = argv[++i];
    } else if (arg === "--confirm") {
      options.confirm = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node scripts/restore-media.mjs --manifest <path> [options]

Options:
  -m, --manifest <path>      Path to media-manifest.json (REQUIRED)
  -f, --files-dir <path>     Directory containing backup media files (optional)
  -t, --target-dir <path>    Target media storage directory (optional)
  -d, --database-url <url>   PostgreSQL connection string to verify DB links
  --confirm                  Confirmation flag for restoration
  -v, --verbose              Enable verbose logging
  -h, --help                 Display this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export async function executeMediaRestore(options = {}) {
  const startTime = Date.now();
  const manifestPath = options.manifestPath;

  if (!manifestPath) {
    const err = new Error("Manifest path is required (provide via --manifest <path>)");
    console.error(`[MEDIA_RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  const resolvedManifestPath = resolve(process.cwd(), manifestPath);
  if (!existsSync(resolvedManifestPath)) {
    const err = new Error(`Manifest file not found at ${resolvedManifestPath}`);
    console.error(`[MEDIA_RESTORE_ERROR] ${err.message}`);
    throw err;
  }

  // Verify manifest checksum if present
  const manifestChecksumFile = `${resolvedManifestPath}.sha256`;
  if (existsSync(manifestChecksumFile)) {
    const expectedManifestHash = readFileSync(manifestChecksumFile, "utf8").trim().split(/\s+/)[0];
    const actualManifestHash = await computeFileSha256(resolvedManifestPath);
    if (expectedManifestHash && actualManifestHash.toLowerCase() !== expectedManifestHash.toLowerCase()) {
      const err = new Error(`Corrupted media manifest: SHA-256 mismatch. Expected ${expectedManifestHash}, got ${actualManifestHash}`);
      console.error(`[MEDIA_RESTORE_INTEGRITY_ERROR] ${err.message}`);
      throw err;
    }
  }

  const manifestContent = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
  const items = manifestContent.items || [];

  let filesRestored = 0;
  let filesVerified = 0;

  const targetDir = options.targetDir ? resolve(process.cwd(), options.targetDir) : null;
  const filesDir = options.filesDir
    ? resolve(process.cwd(), options.filesDir)
    : join(dirname(resolvedManifestPath), "files");

  if (targetDir) {
    mkdirSync(targetDir, { recursive: true });
  }

  if (existsSync(filesDir)) {
    for (const item of items) {
      const candidateFilenames = [
        `${item.mediaId}_${item.type}`,
        `${item.mediaId}`,
        `${item.mediaId}.pdf`,
        `${item.mediaId}.jpg`,
        `${item.mediaId}.png`,
        item.publicId,
      ].filter(Boolean);

      let foundSourceFile = null;
      for (const fn of candidateFilenames) {
        const fullCandidate = join(filesDir, fn);
        if (existsSync(fullCandidate)) {
          foundSourceFile = fullCandidate;
          break;
        }
      }

      if (foundSourceFile) {
        const fileHash = await computeFileSha256(foundSourceFile);
        if (item.sha256 && fileHash.toLowerCase() !== item.sha256.toLowerCase()) {
          const err = new Error(`Corrupted media file for mediaId ${item.mediaId}: Expected ${item.sha256}, got ${fileHash}`);
          console.error(`[MEDIA_RESTORE_INTEGRITY_ERROR] ${err.message}`);
          throw err;
        }
        filesVerified++;

        if (targetDir) {
          const destFile = join(targetDir, `${item.mediaId}`);
          copyFileSync(foundSourceFile, destFile);
          filesRestored++;
        }
      }
    }
  }

  let dbMatchedCount = 0;
  let consentVerifiedCount = 0;

  if (options.databaseUrl) {
    const sql = postgres(options.databaseUrl, { max: 1 });
    try {
      for (const item of items) {
        const [dbRow] = await sql`
          SELECT id, studio_id, client_id, type FROM media WHERE id = ${item.mediaId}
        `;
        if (dbRow) {
          dbMatchedCount++;
        }

        if (item.category === "signed_consent" && item.sha256) {
          const [consentRow] = await sql`
            SELECT id, signed_pdf_sha256 FROM cycle_consents WHERE media_id = ${item.mediaId}
          `;
          if (consentRow && consentRow.signed_pdf_sha256 === item.sha256) {
            consentVerifiedCount++;
          }
        }
      }
    } finally {
      await sql.end();
    }
  }

  const durationMs = Date.now() - startTime;
  const resultMetadata = {
    operation: "media_restore",
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    manifestPath: resolvedManifestPath,
    totalManifestItems: items.length,
    filesVerified,
    filesRestored,
    dbMatchedCount,
    consentVerifiedCount,
    durationMs,
  };

  console.log(JSON.stringify(resultMetadata, null, 2));
  return resultMetadata;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs();
  executeMediaRestore(options).catch((err) => {
    console.error(`[MEDIA_RESTORE_FATAL] ${err.message}`);
    process.exit(1);
  });
}
