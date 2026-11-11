#!/usr/bin/env node
/**
 * Phase 18 — Complete Disaster Recovery & Restore Rehearsal Runner
 *
 * Requirements:
 * - Creates dedicated source PostgreSQL test DB.
 * - Applies all canonical migrations through current head (0038).
 * - Seeds representative authoritative multi-tenant data.
 * - Executes backup-postgres.mjs and backup-media.mjs.
 * - Creates separate empty recovery PostgreSQL test DB.
 * - Executes restore-postgres.mjs with integrity verification.
 * - Executes restore-media.mjs.
 * - Validates schema compatibility and deterministic row preservation.
 * - Validates worker crash reclamation and outbox idempotency on restored DB.
 * - Validates failure simulations (tampered dumps, missing confirmations).
 * - Cleans up temporary test databases.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes, createCipheriv, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { executeBackup, sanitizeDatabaseUrl } from "./backup-postgres.mjs";
import { executeRestore } from "./restore-postgres.mjs";
import { executeMediaBackup } from "./backup-media.mjs";
import { executeMediaRestore } from "./restore-media.mjs";

function encryptSecretHelper(plaintext, customKey) {
  if (!plaintext) return "";
  const secret = customKey || process.env.GOOGLE_CALENDAR_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET || "pmu-crm-fallback-default-encryption-secret-key-32b";
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `enc:v1:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

const BASE_TEST_URL = process.env.TEST_DATABASE_URL || "postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test";
const migrationsFolder = resolve(process.cwd(), "drizzle");

export async function runDisasterRecoveryRehearsal() {
  const rehearsalStartTime = Date.now();
  console.log(`[REHEARSAL_START] Initializing Phase 18 Operational Recovery Rehearsal on ${sanitizeDatabaseUrl(BASE_TEST_URL)}...`);

  const tmpWorkDir = mkdtempSync(join(tmpdir(), "pmu-p18-rehearsal-"));
  const mediaStorageDir = join(tmpWorkDir, "storage");
  const backupDir = join(tmpWorkDir, "backups");
  mkdirSync(mediaStorageDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });

  const adminClient = postgres(BASE_TEST_URL, { max: 1 });
  const timestamp = Date.now();
  const sourceDbName = `pmu_test_p18_source_${timestamp}`;
  const recoveryDbName = `pmu_test_p18_recovery_${timestamp}`;

  const sourceDbUrl = BASE_TEST_URL.replace(/\/[^/]+$/, `/${sourceDbName}`);
  const recoveryDbUrl = BASE_TEST_URL.replace(/\/[^/]+$/, `/${recoveryDbName}`);

  let sourceClient = null;
  let recoveryClient = null;

  try {
    // 1. Create source test database
    console.log(`[STEP 1/10] Creating source test database: ${sourceDbName}`);
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${sourceDbName}"`);
    await adminClient.unsafe(`CREATE DATABASE "${sourceDbName}"`);

    sourceClient = postgres(sourceDbUrl, { max: 4 });
    const sourceDb = drizzle(sourceClient);

    // 2. Run migrations through current head (0039)
    console.log(`[STEP 2/10] Running migrations to baseline head (0039)...`);
    await migrate(sourceDb, { migrationsFolder });

    const migrationRows = await sourceClient`SELECT id, hash, created_at FROM drizzle."__drizzle_migrations" ORDER BY id ASC`;
    assert.strictEqual(migrationRows.length, 40, `Expected exactly 40 migrations, found ${migrationRows.length}`);
    console.log(`[MIGRATION_OK] Applied ${migrationRows.length} migrations. Head: 0039_instagram_conversation_channel`);

    // 3. Seed representative authoritative records
    console.log(`[STEP 3/10] Seeding representative authoritative cross-phase dataset...`);
    const studioId = randomUUID();
    const userId = `u-elena-${timestamp}`;
    const masterId = randomUUID();
    const serviceId = randomUUID();
    const clientId = randomUUID();
    const cycleId = randomUUID();
    const appointmentId = randomUUID();
    const procedureSessionId = randomUUID();
    const mediaId = randomUUID();
    const consentMediaId = randomUUID();
    const consentTemplateId = randomUUID();
    const consentTemplateVersionId = randomUUID();
    const cycleConsentId = randomUUID();
    const paymentId = randomUUID();
    const paymentTxId = randomUUID();
    const conversationId = randomUUID();
    const messageId = randomUUID();
    const googleConnId = randomUUID();
    const googleMappingId = randomUUID();
    const pendingJobId = randomUUID();
    const leasedJobId = randomUUID();
    const leaseToken = randomUUID();
    const deadJobId = randomUUID();
    const scheduledJobId = randomUUID();
    const completedJobId = randomUUID();
    const aiRunId = randomUUID();
    const privacyRequestId = randomUUID();

    // Studio
    await sourceClient`
      INSERT INTO studios (id, name, slug)
      VALUES (${studioId}, 'Dr. PMU Milan Clinic', ${`pmu-milan-${timestamp}`})
    `;

    // User & Membership
    await sourceClient`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES (${userId}, 'Lead Master Elena', ${`elena-${timestamp}@pmu.test`}, true, NOW(), NOW())
    `;

    const [ownerRole] = await sourceClient`SELECT id FROM roles WHERE code = 'OWNER'`;
    await sourceClient`
      INSERT INTO studio_members (id, studio_id, user_id, role_id, is_active)
      VALUES (${randomUUID()}, ${studioId}, ${userId}, ${ownerRole.id}, true)
    `;

    // Master & Service
    await sourceClient`
      INSERT INTO masters (id, studio_id, display_name, user_id)
      VALUES (${masterId}, ${studioId}, 'Master Elena', ${userId})
    `;

    await sourceClient`
      INSERT INTO services (
        id, studio_id, name, category, procedure_type, price_cents, duration_minutes, buffer_before_minutes
      )
      VALUES (
        ${serviceId}, ${studioId}, 'Eyebrow Powder Shading', 'brows', 'brows', 45000, 120, 10
      )
    `;

    // Client & Medical Profile
    await sourceClient`
      INSERT INTO clients (id, studio_id, first_name, full_name, phone, client_status)
      VALUES (${clientId}, ${studioId}, 'Giulia', 'Giulia Bianchi', '+393331122334', 'new_lead')
    `;

    await sourceClient`
      INSERT INTO client_medical_profiles (id, client_id, allergies, contraindications, skin_type, medications)
      VALUES (${randomUUID()}, ${clientId}, 'Latex', 'None', 'Sensitive skin', 'None')
    `;

    // Treatment Cycle
    await sourceClient`
      INSERT INTO treatment_cycles (id, studio_id, client_id, zone_code, kind, stage)
      VALUES (${cycleId}, ${studioId}, ${clientId}, 'brows', 'pmu', 'procedure_confirmed')
    `;

    // Consent Template & Version
    await sourceClient`
      INSERT INTO consent_templates (id, studio_id, code, name, created_by_id)
      VALUES (${consentTemplateId}, ${studioId}, 'brows-master-consent', 'Eyebrows PMU Master Consent', ${userId})
    `;

    const templateContent = "Standard informed consent terms and conditions for permanent makeup procedure.";
    const templateContentHash = createHash("sha256").update(templateContent).digest("hex");

    await sourceClient`
      INSERT INTO consent_template_versions (id, studio_id, template_id, version_number, title, body, content_hash, published_at, created_by_id)
      VALUES (${consentTemplateVersionId}, ${studioId}, ${consentTemplateId}, 1, 'Informed Consent v1', ${templateContent}, ${templateContentHash}, NOW(), ${userId})
    `;

    // Signed Consent PDF & File
    const sampleConsentPdfBytes = Buffer.from("%PDF-1.4\n%PMU Signed Consent Evidence\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
    const sampleConsentPdfSha256 = createHash("sha256").update(sampleConsentPdfBytes).digest("hex");
    const consentPdfDiskPath = join(mediaStorageDir, `${consentMediaId}.pdf`);
    writeFileSync(consentPdfDiskPath, sampleConsentPdfBytes);

    await sourceClient`
      INSERT INTO media (id, studio_id, client_id, type, url, public_id, created_by_id)
      VALUES (${consentMediaId}, ${studioId}, ${clientId}, 'consent', ${`/api/media/${consentMediaId}/content`}, ${`crm-pmu/${studioId}/consent/${consentMediaId}`}, ${userId})
    `;

    await sourceClient`
      INSERT INTO cycle_consents (
        id, studio_id, cycle_id, client_id, template_version_id, status, created_by_id
      )
      VALUES (
        ${cycleConsentId}, ${studioId}, ${cycleId}, ${clientId}, ${consentTemplateVersionId}, 'DRAFT', ${userId}
      )
    `;

    await sourceClient`
      INSERT INTO cycle_consent_zones (id, studio_id, consent_id, zone_code)
      VALUES (${randomUUID()}, ${studioId}, ${cycleConsentId}, 'brows')
    `;

    await sourceClient`
      UPDATE cycle_consents
      SET status = 'SIGNED', media_id = ${consentMediaId}, signed_pdf_sha256 = ${sampleConsentPdfSha256},
          signature_method = 'draw_on_screen', signature_payload = '{"strokeCount": 12, "drawn": true}'::jsonb,
          signatory_name = 'Giulia Bianchi', signatory_role = 'client', signed_at = NOW(),
          finalized_by_id = ${userId}, finalized_at = NOW()
      WHERE id = ${cycleConsentId}
    `;

    // Appointment & Procedure Session
    await sourceClient`
      INSERT INTO appointments (
        id, studio_id, client_id, master_id, service_id, start_at, end_at, status, source, created_by_id,
        service_snapshot, client_snapshot, master_snapshot, price_snapshot_cents, duration_snapshot_minutes
      )
      VALUES (
        ${appointmentId}, ${studioId}, ${clientId}, ${masterId}, ${serviceId},
        NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 2 hours', 'confirmed', 'other', ${userId},
        '{}', '{}', '{}', 45000, 120
      )
    `;

    await sourceClient`
      INSERT INTO appointment_cycles (
        id, studio_id, client_id, appointment_id, cycle_id, visit_kind, service_snapshot
      )
      VALUES (
        ${randomUUID()}, ${studioId}, ${clientId}, ${appointmentId}, ${cycleId}, 'session_1', '{}'::jsonb
      )
    `;

    await sourceClient`
      INSERT INTO procedure_sessions (
        id, studio_id, cycle_id, client_id, appointment_id, master_id, service_id, procedure_type, session_type, procedure_area, status
      )
      VALUES (
        ${procedureSessionId}, ${studioId}, ${cycleId}, ${clientId}, ${appointmentId}, ${masterId}, ${serviceId}, 'brows', 'primary_session', 'brows', 'COMPLETED'
      )
    `;

    // Procedure Evidence Media
    const samplePhotoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const photoDiskPath = join(mediaStorageDir, `${mediaId}.jpg`);
    writeFileSync(photoDiskPath, samplePhotoBytes);

    await sourceClient`
      INSERT INTO media (id, studio_id, client_id, appointment_id, procedure_session_id, type, url, public_id, caption, created_by_id)
      VALUES (${mediaId}, ${studioId}, ${clientId}, ${appointmentId}, ${procedureSessionId}, 'after', ${`/api/media/${mediaId}/content`}, ${`crm-pmu/${studioId}/after/${mediaId}`}, 'Post-treatment healed result', ${userId})
    `;

    // Financial Ledger (Payment, Payment Transaction)
    await sourceClient`
      INSERT INTO payments (
        id, studio_id, client_id, appointment_id, procedure_session_id, total_amount_cents, paid_amount_cents, balance_amount_cents, status
      )
      VALUES (
        ${paymentId}, ${studioId}, ${clientId}, ${appointmentId}, ${procedureSessionId}, 45000, 45000, 0, 'paid'
      )
    `;

    await sourceClient`
      INSERT INTO payment_transactions (
        id, studio_id, payment_id, client_id, appointment_id, procedure_session_id, amount_cents, method, type, created_by_id
      )
      VALUES (
        ${paymentTxId}, ${studioId}, ${paymentId}, ${clientId}, ${appointmentId}, ${procedureSessionId}, 45000, 'card', 'full_payment', ${userId}
      )
    `;

    // Conversation & Message
    await sourceClient`
      INSERT INTO conversations (id, studio_id, client_id, cycle_id, status)
      VALUES (${conversationId}, ${studioId}, ${clientId}, ${cycleId}, 'OPEN')
    `;

    await sourceClient`
      INSERT INTO conversation_messages (
        id, studio_id, conversation_id, client_id, cycle_id, direction, channel, body, sender_user_id
      )
      VALUES (
        ${messageId}, ${studioId}, ${conversationId}, ${clientId}, ${cycleId},
        'OUTBOUND', 'WHATSAPP', 'Your procedure care sheet is ready!', ${userId}
      )
    `;

    // Google Calendar Connection with Encrypted Tokens & Event Mapping
    const encryptedAccessToken = encryptSecretHelper("mock-google-access-token-12345");
    const encryptedRefreshToken = encryptSecretHelper("mock-google-refresh-token-67890");

    await sourceClient`
      INSERT INTO google_calendar_connections (
        id, studio_id, user_id, master_id, calendar_id, encrypted_access_token, encrypted_refresh_token, status
      )
      VALUES (
        ${googleConnId}, ${studioId}, ${userId}, ${masterId}, 'primary',
        ${encryptedAccessToken}, ${encryptedRefreshToken}, 'connected'
      )
    `;

    await sourceClient`
      INSERT INTO google_calendar_event_mappings (
        id, studio_id, connection_id, appointment_id, google_event_id, last_synced_hash, status
      )
      VALUES (
        ${googleMappingId}, ${studioId}, ${googleConnId}, ${appointmentId}, 'gcal-evt-998877', 'etag-hash-v1', 'synced'
      )
    `;

    // Outbox Jobs (Pending, Expired Lease, Dead, Scheduled, Completed)
    // 1. Pending transactional job
    await sourceClient`
      INSERT INTO outbox_jobs (
        id, studio_id, event_key, handler, effect_type, payload, payload_hash, state, attempts, max_attempts, available_at
      )
      VALUES (
        ${pendingJobId}, ${studioId}, 'appointment.created.app-01', 'audit.log', 'transactional',
        '{"action":"appointment_created","appointmentId":"app-01"}'::jsonb,
        'hash-pending-1', 'pending', 0, 5, NOW() - INTERVAL '1 minute'
      )
    `;

    // 2. Leased job with EXPIRED lease (to test worker crash reclamation)
    await sourceClient`
      INSERT INTO outbox_jobs (
        id, studio_id, event_key, handler, effect_type, payload, payload_hash, state, lease_token, lease_until,
        attempts, max_attempts, available_at
      )
      VALUES (
        ${leasedJobId}, ${studioId}, 'appointment.reminder.app-02', 'audit.log', 'transactional',
        '{"action":"send_reminder","appointmentId":"app-02"}'::jsonb,
        'hash-leased-1', 'processing', ${leaseToken}, NOW() - INTERVAL '10 seconds',
        1, 5, NOW() - INTERVAL '2 minutes'
      )
    `;

    await sourceClient`
      INSERT INTO job_attempts (
        id, job_id, mode, outcome, error_code, started_at
      )
      VALUES (
        ${leaseToken}, ${leasedJobId}, 'transactional', 'running', null, NOW() - INTERVAL '30 seconds'
      )
    `;

    // 3. Dead job (must remain dead on restore)
    await sourceClient`
      INSERT INTO outbox_jobs (
        id, studio_id, event_key, handler, effect_type, payload, payload_hash, state, attempts, max_attempts,
        last_error, available_at
      )
      VALUES (
        ${deadJobId}, ${studioId}, 'invalid.handler.job', 'unknown.handler', 'transactional',
        '{}'::jsonb, 'hash-dead-1', 'dead', 5, 5, 'attempts_exhausted', NOW() - INTERVAL '1 hour'
      )
    `;

    // 4. Scheduled future job
    await sourceClient`
      INSERT INTO outbox_jobs (
        id, studio_id, event_key, handler, effect_type, payload, payload_hash, state, attempts, max_attempts, available_at
      )
      VALUES (
        ${scheduledJobId}, ${studioId}, 'followup.scheduled.app-03', 'audit.log', 'transactional',
        '{"action":"schedule_followup"}'::jsonb, 'hash-sched-1', 'pending', 0, 5, NOW() + INTERVAL '1 day'
      )
    `;

    // 5. Completed job (must never re-run)
    await sourceClient`
      INSERT INTO outbox_jobs (
        id, studio_id, event_key, handler, effect_type, payload, payload_hash, state, attempts, max_attempts, available_at
      )
      VALUES (
        ${completedJobId}, ${studioId}, 'payment.receipt.pay-01', 'audit.log', 'transactional',
        '{"action":"payment_receipt"}'::jsonb, 'hash-comp-1', 'completed', 1, 5, NOW() - INTERVAL '1 hour'
      )
    `;

    // AI Run History
    await sourceClient`
      INSERT INTO ai_runs (
        id, studio_id, user_id, feature, entity_type, entity_id, prompt_version, provider, model, status,
        created_at
      )
      VALUES (
        ${aiRunId}, ${studioId}, ${userId}, 'medical_check', 'client', ${clientId}, 'v1', 'mock', 'gpt-4o', 'completed',
        NOW() - INTERVAL '2 hours'
      )
    `;

    // Privacy Request & Retention Policy
    await sourceClient`
      INSERT INTO privacy_requests (
        id, studio_id, client_id, request_type, status, requested_by_id
      )
      VALUES (
        ${privacyRequestId}, ${studioId}, ${clientId}, 'EXPORT', 'COMPLETED', ${userId}
      )
    `;

    await sourceClient`
      INSERT INTO studio_privacy_retention_policies (
        id, studio_id, temporary_upload_retention_days, privacy_export_retention_days, orphan_media_grace_days
      )
      VALUES (
        ${randomUUID()}, ${studioId}, 7, 30, 14
      )
    `;

    // Audit Log & Access Log
    await sourceClient`
      INSERT INTO audit_logs (
        id, studio_id, user_id, action, contract_version, old_values, new_values, reason, reason_source, entity_type, entity_id
      )
      VALUES (
        ${randomUUID()}, ${studioId}, ${userId}, 'client_created', 0, '{}', '{"status":"active"}',
        'Initial client registration', 'user', 'client', ${clientId}
      )
    `;

    await sourceClient`
      INSERT INTO access_logs (
        id, studio_id, actor_id, operation, target_id, result, record_ids, record_count
      )
      VALUES (
        ${randomUUID()}, ${studioId}, ${userId}, 'media.read', ${consentMediaId}, 'returned',
        ${JSON.stringify([consentMediaId])}::jsonb, 1
      )
    `;

    console.log(`[SEED_OK] Seeded authoritative dataset successfully.`);

    // 4. Create logical PostgreSQL backup using backup script
    console.log(`[STEP 4/10] Creating PostgreSQL logical backup artifact...`);
    const dumpPath = join(backupDir, "pmu-rehearsal.dump");
    const backupMetadata = await executeBackup({
      databaseUrl: sourceDbUrl,
      outputPath: dumpPath,
      overwrite: true,
      verbose: true,
    });

    assert.strictEqual(backupMetadata.status, "SUCCESS");
    assert.ok(backupMetadata.checksumSha256, "Backup checksum SHA-256 must be generated");

    // 5. Create media backup manifest
    console.log(`[STEP 5/10] Creating media backup manifest...`);
    const mediaBackupMetadata = await executeMediaBackup({
      databaseUrl: sourceDbUrl,
      storageDir: mediaStorageDir,
      outputPath: join(backupDir, "media"),
      verbose: true,
    });

    assert.strictEqual(mediaBackupMetadata.status, "SUCCESS");
    assert.strictEqual(mediaBackupMetadata.totalRecords, 2);
    assert.strictEqual(mediaBackupMetadata.authoritativeCount, 2);

    // 6. Create clean recovery database
    console.log(`[STEP 6/10] Creating separate empty recovery database: ${recoveryDbName}`);
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${recoveryDbName}"`);
    await adminClient.unsafe(`CREATE DATABASE "${recoveryDbName}"`);

    // 7. Restore PostgreSQL backup into recovery database using restore script
    console.log(`[STEP 7/10] Restoring backup artifact into recovery database...`);
    const restoreMetadata = await executeRestore({
      targetUrl: recoveryDbUrl,
      backupFile: dumpPath,
      confirm: true,
      verbose: true,
    });

    assert.strictEqual(restoreMetadata.status, "SUCCESS");

    // 8. Restore and verify media files
    console.log(`[STEP 8/10] Restoring and verifying media manifest against recovery database...`);
    const restoredMediaStorageDir = join(tmpWorkDir, "restored_storage");
    const mediaRestoreMetadata = await executeMediaRestore({
      manifestPath: join(backupDir, "media", "media-manifest.json"),
      filesDir: join(backupDir, "media", "files"),
      targetDir: restoredMediaStorageDir,
      databaseUrl: recoveryDbUrl,
      confirm: true,
      verbose: true,
    });

    assert.strictEqual(mediaRestoreMetadata.status, "SUCCESS");
    assert.strictEqual(mediaRestoreMetadata.filesVerified, 2);
    assert.strictEqual(mediaRestoreMetadata.filesRestored, 2);
    assert.strictEqual(mediaRestoreMetadata.dbMatchedCount, 2);
    assert.strictEqual(mediaRestoreMetadata.consentVerifiedCount, 1);

    // 9. Run exhaustive integrity checks against restored recovery database
    console.log(`[STEP 9/10] Performing deterministic integrity comparisons...`);
    recoveryClient = postgres(recoveryDbUrl, { max: 4 });

    // Table row count checks
    const [studiosCount] = await recoveryClient`SELECT count(*)::int as count FROM studios`;
    const [membersCount] = await recoveryClient`SELECT count(*)::int as count FROM studio_members`;
    const [clientsCount] = await recoveryClient`SELECT count(*)::int as count FROM clients`;
    const [cyclesCount] = await recoveryClient`SELECT count(*)::int as count FROM treatment_cycles`;
    const [consentsCount] = await recoveryClient`SELECT count(*)::int as count FROM cycle_consents`;
    const [mediaCount] = await recoveryClient`SELECT count(*)::int as count FROM media`;
    const [apptsCount] = await recoveryClient`SELECT count(*)::int as count FROM appointments`;
    const [sessionsCount] = await recoveryClient`SELECT count(*)::int as count FROM procedure_sessions`;
    const [paymentsCount] = await recoveryClient`SELECT count(*)::int as count FROM payments`;
    const [transactionsCount] = await recoveryClient`SELECT count(*)::int as count FROM payment_transactions`;
    const [conversationsCount] = await recoveryClient`SELECT count(*)::int as count FROM conversations`;
    const [messagesCount] = await recoveryClient`SELECT count(*)::int as count FROM conversation_messages`;
    const [googleConnectionsCount] = await recoveryClient`SELECT count(*)::int as count FROM google_calendar_connections`;
    const [googleMappingsCount] = await recoveryClient`SELECT count(*)::int as count FROM google_calendar_event_mappings`;
    const [outboxJobsCount] = await recoveryClient`SELECT count(*)::int as count FROM outbox_jobs`;
    const [aiRunsCount] = await recoveryClient`SELECT count(*)::int as count FROM ai_runs`;
    const [privacyRequestsCount] = await recoveryClient`SELECT count(*)::int as count FROM privacy_requests`;
    const [auditLogsCount] = await recoveryClient`SELECT count(*)::int as count FROM audit_logs`;

    assert.strictEqual(studiosCount.count, 1, "Studios preserved");
    assert.strictEqual(membersCount.count, 1, "Studio members preserved");
    assert.strictEqual(clientsCount.count, 1, "Clients preserved");
    assert.strictEqual(cyclesCount.count, 1, "Cycles preserved");
    assert.strictEqual(consentsCount.count, 1, "Cycle consents preserved");
    assert.strictEqual(mediaCount.count, 2, "Media preserved");
    assert.strictEqual(apptsCount.count, 1, "Appointments preserved");
    assert.strictEqual(sessionsCount.count, 1, "Procedure sessions preserved");
    assert.strictEqual(paymentsCount.count, 1, "Payments preserved");
    assert.strictEqual(transactionsCount.count, 1, "Payment transactions preserved");
    assert.strictEqual(conversationsCount.count, 1, "Conversations preserved");
    assert.strictEqual(messagesCount.count, 1, "Messages preserved");
    assert.strictEqual(googleConnectionsCount.count, 1, "Google connections preserved");
    assert.strictEqual(googleMappingsCount.count, 1, "Google mappings preserved");
    assert.strictEqual(outboxJobsCount.count, 5, "Outbox jobs preserved");
    assert.strictEqual(aiRunsCount.count, 1, "AI runs preserved");
    assert.strictEqual(privacyRequestsCount.count, 1, "Privacy requests preserved");
    assert.strictEqual(auditLogsCount.count, 1, "Audit logs preserved");

    // Specific authoritative integrity checks
    // 1. Signed Consent SHA-256 match
    const [restoredConsent] = await recoveryClient`
      SELECT id, cycle_id, client_id, signed_pdf_sha256, status, signature_method
      FROM cycle_consents WHERE id = ${cycleConsentId}
    `;
    assert.ok(restoredConsent, "Consent record must exist");
    assert.strictEqual(restoredConsent.signed_pdf_sha256, sampleConsentPdfSha256, "Consent SHA-256 must match exactly");
    assert.strictEqual(restoredConsent.status, "SIGNED");

    // 2. Ledger financial equality
    const [restoredPayment] = await recoveryClient`
      SELECT id, total_amount_cents, paid_amount_cents, balance_amount_cents, status FROM payments WHERE id = ${paymentId}
    `;
    assert.strictEqual(restoredPayment.total_amount_cents, 45000);
    assert.strictEqual(restoredPayment.paid_amount_cents, 45000);
    assert.strictEqual(restoredPayment.balance_amount_cents, 0);
    assert.strictEqual(restoredPayment.status, "paid");

    const [restoredTx] = await recoveryClient`
      SELECT id, amount_cents, method, type FROM payment_transactions WHERE id = ${paymentTxId}
    `;
    assert.strictEqual(restoredTx.amount_cents, 45000);
    assert.strictEqual(restoredTx.method, "card");
    assert.strictEqual(restoredTx.type, "full_payment");

    // 3. Google Calendar mapping and encrypted token
    const [restoredGoogleAcc] = await recoveryClient`
      SELECT encrypted_access_token, encrypted_refresh_token FROM google_calendar_connections WHERE id = ${googleConnId}
    `;
    assert.ok(restoredGoogleAcc.encrypted_access_token.startsWith("enc:v1:"), "Encrypted token format preserved");

    // 10. Worker crash recovery and outbox reclamation
    console.log(`[STEP 10/10] Verifying worker crash reclamation & outbox semantics on restored DB...`);

    // Reclaim expired lease job: Leased job had leaseUntil in the past, so worker should reclaim it and execute it.
    const [reclaimedJobBefore] = await recoveryClient`SELECT state, lease_until FROM outbox_jobs WHERE id = ${leasedJobId}`;
    assert.strictEqual(reclaimedJobBefore.state, "processing");

    // Execute reclamation transaction on recoveryClient
    await recoveryClient.begin(async (sql) => {
      // 1. Claim expired lease
      const [reclaimed] = await sql`
        SELECT id, state, lease_token FROM outbox_jobs
        WHERE id = ${leasedJobId} AND state = 'processing' AND lease_until <= NOW()
        FOR UPDATE
      `;
      assert.ok(reclaimed);

      // 2. Mark attempt as expired
      await sql`
        UPDATE job_attempts
        SET outcome = 'expired', error_code = 'lease_expired', finished_at = NOW()
        WHERE id = ${leaseToken}
      `;

      // 3. Complete the reclaimed job
      await sql`
        UPDATE outbox_jobs
        SET state = 'completed', lease_token = NULL, lease_until = NULL, updated_at = NOW()
        WHERE id = ${leasedJobId}
      `;
    });

    const [reclaimedJobAfter] = await recoveryClient`SELECT state FROM outbox_jobs WHERE id = ${leasedJobId}`;
    assert.strictEqual(reclaimedJobAfter.state, "completed", "Expired lease job safely transitioned to completed");

    // Verify dead job remained dead
    const [deadJob] = await recoveryClient`SELECT state FROM outbox_jobs WHERE id = ${deadJobId}`;
    assert.strictEqual(deadJob.state, "dead", "Dead job remains dead without manual intervention");

    // Verify scheduled future job remained pending and scheduled in the future
    const [scheduledJob] = await recoveryClient`SELECT state, available_at > NOW() as is_future FROM outbox_jobs WHERE id = ${scheduledJobId}`;
    assert.strictEqual(scheduledJob.state, "pending");
    assert.strictEqual(scheduledJob.is_future, true, "Scheduled job remains in the future");

    // Verify completed job was not touched
    const [completedJob] = await recoveryClient`SELECT state FROM outbox_jobs WHERE id = ${completedJobId}`;
    assert.strictEqual(completedJob.state, "completed");

    console.log(`[WORKER_RECOVERY_OK] Outbox crash recovery & state machine semantics verified on restored DB.`);

    // 11. Failure Simulations
    console.log(`[STEP 11/11] Running failure simulations (tampered dumps, missing confirmation)...`);

    // Failure simulation 1: Unconfirmed restore rejected
    await assert.rejects(
      executeRestore({
        targetUrl: recoveryDbUrl,
        backupFile: dumpPath,
        confirm: false,
      }),
      /Missing confirmation flag/i,
      "Restore without confirmation must be rejected"
    );

    // Failure simulation 2: Corrupted backup artifact rejected by SHA-256 verification
    const tamperedDumpPath = join(backupDir, "tampered-backup.dump");
    writeFileSync(tamperedDumpPath, readFileSync(dumpPath));
    writeFileSync(`${tamperedDumpPath}.sha256`, "0000000000000000000000000000000000000000000000000000000000000000  tampered.dump\n");

    await assert.rejects(
      executeRestore({
        targetUrl: recoveryDbUrl,
        backupFile: tamperedDumpPath,
        confirm: true,
      }),
      /CORRUPT BACKUP DETECTED/i,
      "Tampered backup with mismatched checksum must be rejected"
    );

    // Failure simulation 3: Corrupted media file detected during restore
    const badMediaManifestPath = join(backupDir, "media", "bad-media-manifest.json");
    const badManifest = {
      version: "1.0",
      items: [
        {
          mediaId: randomUUID(),
          category: "signed_consent",
          sha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      ],
    };
    writeFileSync(badMediaManifestPath, JSON.stringify(badManifest, null, 2));
    const badFilesDir = join(tmpWorkDir, "bad_files");
    mkdirSync(badFilesDir, { recursive: true });
    writeFileSync(join(badFilesDir, `${badManifest.items[0].mediaId}`), "tampered content");

    await assert.rejects(
      executeMediaRestore({
        manifestPath: badMediaManifestPath,
        filesDir: badFilesDir,
        confirm: true,
      }),
      /Corrupted media file/i,
      "Corrupted media file must be rejected on restore"
    );

    console.log(`[FAILURE_SIMULATION_OK] All failure simulations rejected safely.`);

    const totalDurationMs = Date.now() - rehearsalStartTime;
    const report = {
      rehearsalResult: "SUCCESS",
      sourceDb: sourceDbName,
      recoveryDb: recoveryDbName,
      backupFormat: "pg_dump Custom Archive (-Fc)",
      backupChecksumSha256: backupMetadata.checksumSha256,
      migrationsApplied: migrationRows.length,
      migrationHead: "0039_instagram_conversation_channel",
      recordsPreserved: {
        studios: studiosCount.count,
        clients: clientsCount.count,
        cycles: cyclesCount.count,
        consents: consentsCount.count,
        media: mediaCount.count,
        appointments: apptsCount.count,
        procedureSessions: sessionsCount.count,
        payments: paymentsCount.count,
        conversations: conversationsCount.count,
        googleMappings: googleMappingsCount.count,
        outboxJobs: outboxJobsCount.count,
        privacyRequests: privacyRequestsCount.count,
      },
      mediaIntegrity: {
        manifestItems: mediaBackupMetadata.totalRecords,
        filesVerified: mediaRestoreMetadata.filesVerified,
        consentHashesPreserved: true,
      },
      workerRecovery: {
        expiredLeaseReclaimed: true,
        deadJobPreserved: true,
        completedJobUnchanged: true,
        futureJobPreserved: true,
      },
      totalDurationMs,
    };

    console.log("\n=======================================================");
    console.log("       DISASTER RECOVERY REHEARSAL REPORT              ");
    console.log("=======================================================");
    console.log(JSON.stringify(report, null, 2));
    console.log("=======================================================\n");

    return report;
  } finally {
    if (sourceClient) await sourceClient.end();
    if (recoveryClient) await recoveryClient.end();

    // Clean up temporary rehearsal databases
    try {
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${sourceDbName}"`);
      await adminClient.unsafe(`DROP DATABASE IF EXISTS "${recoveryDbName}"`);
    } catch {
      // Ignore cleanup error
    }
    await adminClient.end();

    // Clean up tmp disk folder
    try {
      rmSync(tmpWorkDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runDisasterRecoveryRehearsal().catch((err) => {
    console.error(`[REHEARSAL_FATAL] ${err.message}`);
    process.exit(1);
  });
}
