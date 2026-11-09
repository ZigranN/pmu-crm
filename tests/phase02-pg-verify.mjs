/**
 * Phase 0.2 — PostgreSQL 17 migration chain verification.
 * Disposable test DB only. No production credentials.
 */
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));

// Reuse canonical test database safety helper directly from repository support code
const supportUrlPath = fileURLToPath(new URL("./support/database-url.ts", import.meta.url));
const supportUrlSource = await readFile(supportUrlPath, "utf8");
const supportUrlJs = supportUrlSource
  .replace("value: string | undefined", "value")
  .replace("): string {", ") {");
const { assertTestDatabaseUrl } = await import(`data:text/javascript,${encodeURIComponent(supportUrlJs)}`);

const DB_URL = assertTestDatabaseUrl(
  process.env.TEST_DATABASE_URL || "postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test"
);

async function createTestDb(t, name) {
  const admin = postgres(DB_URL, { max: 1 });
  const dbName = `pmu_test_p02_${name}_${Date.now()}`;
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const dbUrl = DB_URL.replace(/\/[^/]+$/, `/${dbName}`);
  const sql = postgres(dbUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    const c = postgres(DB_URL, { max: 1 });
    await c.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await c.end();
  });
  return sql;
}

async function buildPartialMigrationFolder(t, upTo) {
  const dir = await mkdtemp(path.join(tmpdir(), "pmu-mig-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "meta"));
  const journal = await readJson(path.join(migrationsFolder, "meta/_journal.json"));
  const partial = { ...journal, entries: journal.entries.slice(0, upTo + 1) };
  await writeFile(path.join(dir, "meta/_journal.json"), JSON.stringify(partial));
  for (const entry of partial.entries) {
    await copyFile(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(dir, `${entry.tag}.sql`));
    await copyFile(
      path.join(migrationsFolder, "meta", `${String(entry.idx).padStart(4,"0")}_snapshot.json`),
      path.join(dir, "meta", `${String(entry.idx).padStart(4,"0")}_snapshot.json`)
    );
  }
  return dir;
}

async function scaffold(sql, tag, stage) {
  const [studio] = await sql`INSERT INTO studios (name,slug) VALUES (${tag},${tag.toLowerCase()}) RETURNING id`;
  const userId = `u-${tag.toLowerCase()}`;
  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES (${userId},${tag},${tag.toLowerCase()+'@t.t'},false,now(),now())`;
  const phone = '+' + String(Math.floor(Math.random()*9e9)+1e9);
  const [client] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${studio.id},${tag},${tag+' '+tag},${phone},'new_lead','') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (studio_id,display_name) VALUES (${studio.id},${tag+' M'}) RETURNING id`;
  const [svc] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studio.id},${tag+' S'},'brows','brows',5000,60,10) RETURNING id`;
  const [cycle] = await sql`INSERT INTO treatment_cycles (studio_id,client_id,zone_code,kind,stage) VALUES (${studio.id},${client.id},'brows','pmu',${stage}) RETURNING id`;
  return { studio, client, master, svc, cycle, userId };
}

/** Create completed appointment + appointment_cycle for consultation tests */
async function makeConsultationVisit(sql, s) {
  const [appt] = await sql`INSERT INTO appointments (studio_id,client_id,master_id,service_id,start_at,end_at,status,source,created_by_id,service_snapshot,client_snapshot,master_snapshot,price_snapshot_cents,duration_snapshot_minutes) VALUES (${s.studio.id},${s.client.id},${s.master.id},${s.svc.id},'2025-01-01 10:00','2025-01-01 11:00','completed','other',${s.userId},'{}','{}','{}',5000,60) RETURNING id`;
  await sql`INSERT INTO appointment_cycles (studio_id,client_id,appointment_id,cycle_id,visit_kind,service_snapshot) VALUES (${s.studio.id},${s.client.id},${appt.id},${s.cycle.id},'consultation','{}')`;
  return appt;
}

// ─── 1. RECONCILIATION ────────────────────────────────────────────
test("journal/SQL/snapshot exact reconciliation", async () => {
  const journal = await readJson(path.join(migrationsFolder, "meta/_journal.json"));
  assert.equal(journal.entries.length, 39, "Journal must contain exactly 39 entries");

  const actualSqlFiles = readdirSync(migrationsFolder).filter(f => f.endsWith(".sql")).sort();
  const actualSnapshots = readdirSync(path.join(migrationsFolder, "meta")).filter(f => f.endsWith("_snapshot.json")).sort();

  assert.equal(actualSqlFiles.length, 39, "Filesystem must contain exactly 39 SQL migration files");
  assert.equal(actualSnapshots.length, 39, "Filesystem must contain exactly 39 snapshot files");

  const expectedSql = new Set();
  const expectedSnapshots = new Set();
  const seenIdxs = new Set();
  const seenTags = new Set();
  let prevTime = 0;
  let prevSnapId = "00000000-0000-0000-0000-000000000000";

  for (const [i, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, i, `Journal index gap or misorder at position ${i}, got idx ${entry.idx}`);
    assert.ok(!seenIdxs.has(entry.idx), `Duplicate journal idx ${entry.idx}`);
    assert.ok(!seenTags.has(entry.tag), `Duplicate journal tag ${entry.tag}`);
    assert.ok(entry.when > prevTime, `Journal timestamps must strictly increase at idx ${entry.idx}`);

    seenIdxs.add(entry.idx);
    seenTags.add(entry.tag);
    prevTime = entry.when;

    const expectedSqlFile = `${entry.tag}.sql`;
    const expectedSnapFile = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;

    expectedSql.add(expectedSqlFile);
    expectedSnapshots.add(expectedSnapFile);

    const snapPath = path.join(migrationsFolder, "meta", expectedSnapFile);
    let snap;
    try {
      snap = await readJson(snapPath);
    } catch (err) {
      assert.fail(`Snapshot file ${expectedSnapFile} is missing or invalid JSON: ${err.message}`);
    }

    assert.equal(snap.dialect, "postgresql", `Snapshot ${expectedSnapFile} must have dialect postgresql`);
    assert.equal(snap.version, "7", `Snapshot ${expectedSnapFile} must have version 7`);
    assert.equal(snap.prevId, prevSnapId, `Snapshot ${expectedSnapFile} broken lineage: prevId ${snap.prevId} !== ${prevSnapId}`);
    assert.ok(typeof snap.id === "string" && snap.id.length > 0, `Snapshot ${expectedSnapFile} missing id`);
    prevSnapId = snap.id;
  }

  assert.equal(journal.entries[0].tag, "0000_windy_the_watchers");
  assert.equal(journal.entries[20].tag, "0020_cycle_commercial_terms");
  assert.equal(journal.entries[21].tag, "0021_medical_profile_revisions");
  assert.equal(journal.entries[22].tag, "0022_huge_madame_hydra");
  assert.equal(journal.entries[23].tag, "0023_spicy_stone_men");
  assert.equal(journal.entries[24].tag, "0024_far_cannonball");
  assert.equal(journal.entries[25].tag, "0025_fixed_doorman");
  assert.equal(journal.entries[26].tag, "0026_natural_ozymandias");
  assert.equal(journal.entries[27].tag, "0027_bored_shen");
  assert.equal(journal.entries[28].tag, "0028_ancient_pixie");
  assert.equal(journal.entries[29].tag, "0029_wise_clea");
  assert.equal(journal.entries[30].tag, "0030_procedure_execution");
  assert.equal(journal.entries[31].tag, "0031_total_face_remover");
  assert.equal(journal.entries[32].tag, "0032_conversations_subsystem");
  assert.equal(journal.entries[33].tag, "0033_medical_romulus");
  assert.equal(journal.entries[34].tag, "0034_chief_nomad");
  assert.equal(journal.entries[35].tag, "0035_square_yellow_claw");
  assert.equal(journal.entries[36].tag, "0036_omniscient_blue_shield");
  assert.equal(journal.entries[37].tag, "0037_awesome_the_anarchist");
  assert.equal(journal.entries[38].tag, "0038_freezing_spyke");
  assert.equal(journal.entries.at(-1).tag, "0038_freezing_spyke", "Accepted migration head must be 0038_freezing_spyke");

  // Exact set comparisons for SQL migration files
  for (const f of actualSqlFiles) {
    assert.ok(expectedSql.has(f), `Orphan SQL file in drizzle/: ${f}`);
  }
  for (const f of expectedSql) {
    assert.ok(actualSqlFiles.includes(f), `Missing SQL file in drizzle/: ${f}`);
  }

  // Exact set comparisons for snapshot files
  for (const f of actualSnapshots) {
    assert.match(f, /^\d{4}_snapshot\.json$/, `Unexpected snapshot numbering/format: ${f}`);
    assert.ok(expectedSnapshots.has(f), `Orphan snapshot file in drizzle/meta: ${f}`);
  }
  for (const f of expectedSnapshots) {
    assert.ok(actualSnapshots.includes(f), `Missing snapshot file in drizzle/meta: ${f}`);
  }
});

// ─── 2. FRESH MIGRATION ───────────────────────────────────────────
test("fresh 0000-0036 via Drizzle migrator", async (t) => {
  const sql = await createTestDb(t, "fresh");
  await migrate(drizzle(sql), { migrationsFolder });
  const history = await sql`SELECT * FROM drizzle."__drizzle_migrations" ORDER BY id`;
  assert.equal(history.length, 39);
  // 0021: accepted head creates medical_profile_revisions
  assert.equal((await sql`SELECT to_regclass('public.medical_profile_revisions')::text AS r`)[0].r, "medical_profile_revisions", "missing table medical_profile_revisions (0021)");
  // 0022: accepted head creates cycle_medical_clearances
  assert.equal((await sql`SELECT to_regclass('public.cycle_medical_clearances')::text AS r`)[0].r, "cycle_medical_clearances", "missing table cycle_medical_clearances (0022)");
  // 0024: creates consent_templates and consent_template_versions
  assert.equal((await sql`SELECT to_regclass('public.consent_templates')::text AS r`)[0].r, "consent_templates", "missing table consent_templates (0024)");
  assert.equal((await sql`SELECT to_regclass('public.consent_template_versions')::text AS r`)[0].r, "consent_template_versions", "missing table consent_template_versions (0024)");
  // 0025: creates cycle_consents and cycle_consent_zones
  assert.equal((await sql`SELECT to_regclass('public.cycle_consents')::text AS r`)[0].r, "cycle_consents", "missing table cycle_consents (0025)");
  assert.equal((await sql`SELECT to_regclass('public.cycle_consent_zones')::text AS r`)[0].r, "cycle_consent_zones", "missing table cycle_consent_zones (0025)");
  // 0029: creates ledger_entries
  assert.equal((await sql`SELECT to_regclass('public.ledger_entries')::text AS r`)[0].r, "ledger_entries", "missing table ledger_entries (0029)");
  // 0027: creates calendar_exceptions
  assert.equal((await sql`SELECT to_regclass('public.calendar_exceptions')::text AS r`)[0].r, "calendar_exceptions", "missing table calendar_exceptions (0027)");
  // 0032: creates conversations, conversation_messages, conversation_read_states
  assert.equal((await sql`SELECT to_regclass('public.conversations')::text AS r`)[0].r, "conversations", "missing table conversations (0032)");
  assert.equal((await sql`SELECT to_regclass('public.conversation_messages')::text AS r`)[0].r, "conversation_messages", "missing table conversation_messages (0032)");
  assert.equal((await sql`SELECT to_regclass('public.conversation_read_states')::text AS r`)[0].r, "conversation_read_states", "missing table conversation_read_states (0032)");
  // 0033: creates automation_rules, automation_executions
  assert.equal((await sql`SELECT to_regclass('public.automation_rules')::text AS r`)[0].r, "automation_rules", "missing table automation_rules (0033)");
  assert.equal((await sql`SELECT to_regclass('public.automation_executions')::text AS r`)[0].r, "automation_executions", "missing table automation_executions (0033)");
  // 0034: creates google_calendar_connections, google_calendar_event_mappings
  assert.equal((await sql`SELECT to_regclass('public.google_calendar_connections')::text AS r`)[0].r, "google_calendar_connections", "missing table google_calendar_connections (0034)");
  assert.equal((await sql`SELECT to_regclass('public.google_calendar_event_mappings')::text AS r`)[0].r, "google_calendar_event_mappings", "missing table google_calendar_event_mappings (0034)");
  // 0035: creates ai_runs
  assert.equal((await sql`SELECT to_regclass('public.ai_runs')::text AS r`)[0].r, "ai_runs", "missing table ai_runs (0035)");
  // 0036: creates handoffs
  assert.equal((await sql`SELECT to_regclass('public.handoffs')::text AS r`)[0].r, "handoffs", "missing table handoffs (0036)");
  // 0037: creates worker_heartbeats
  assert.equal((await sql`SELECT to_regclass('public.worker_heartbeats')::text AS r`)[0].r, "worker_heartbeats", "missing table worker_heartbeats (0037)");
  // 0030: procedure_sessions execution lifecycle columns & partial unique index
  const procCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='procedure_sessions'`).map(r => r.column_name);
  for (const col of ["status", "started_at", "completed_at", "aborted_at", "abort_reason", "command_id", "service_snapshot", "master_snapshot", "client_snapshot"]) {
    assert.ok(procCols.includes(col), `missing column ${col} in procedure_sessions (0030)`);
  }
  // 0031: treatment_packages status, created_by_id, completed_at
  const pkgCols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='treatment_packages'`).map(r => r.column_name);
  for (const col of ["status", "created_by_id", "completed_at"]) {
    assert.ok(pkgCols.includes(col), `missing column ${col} in treatment_packages (0031)`);
  }
  const procIndexes = (await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='procedure_sessions'`).map(r => r.indexname);
  for (const idx of ["procedure_sessions_studio_status_idx", "procedure_sessions_active_cycle_unique", "procedure_sessions_active_appointment_unique", "procedure_sessions_command_unique"]) {
    assert.ok(procIndexes.includes(idx), `missing index ${idx} on procedure_sessions (0030)`);
  }
  assert.deepEqual(history.map(r=>r.hash), readMigrationFiles({migrationsFolder}).map(m=>m.hash));
  const fns = await sql`SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND proname LIKE 'pmu_%' ORDER BY proname`;
  for (const fn of ["pmu_check_offer_revision_total","pmu_commercial_terms_guard","pmu_consultation_evidence_guard","pmu_consultation_immutable","pmu_consultation_task_guard","pmu_cycle_history_immutable","pmu_cycle_history_receipt","pmu_cycle_review_guard","pmu_cycle_stage_evidence","pmu_email_key","pmu_follow_up_closure_guard","pmu_follow_up_revision_guard","pmu_follow_up_task_guard","pmu_guard_consent_template_version","pmu_guard_cycle_consent","pmu_guard_cycle_consent_zone","pmu_guard_offer_identity","pmu_instagram_key","pmu_lock_cycle_studio","pmu_name_key","pmu_offer_item_creation_only","pmu_phone_key","pmu_reject_message_change","pmu_reject_pricing_history_change","pmu_validate_cycle_links","pmu_validate_procedure_cycle"])
    assert.ok(fns.map(r=>r.proname).includes(fn), `missing fn ${fn}`);
  const trigs = await sql`SELECT tgname FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY tgname`;
  for (const trig of ["client_merge_history_immutable","commercial_terms_immutable","consent_template_version_guard","consultation_immutable","consultation_result_immutable","conversation_messages_immutable","cycle_consent_guard","cycle_consent_zone_guard","cycle_history_immutable","cycle_review_immutable","cycle_studio_lock","follow_up_closure_immutable","follow_up_revision_immutable","master_price_history_immutable","offer_identity_immutable","offer_item_immutable","offer_items_creation_only","offer_revision_immutable","qualification_immutable"])
    assert.ok(trigs.map(r=>r.tgname).includes(trig), `missing trig ${trig}`);
});

// ─── 3. REPEAT ─────────────────────────────────────────────────────
test("repeat migration idempotent", async (t) => {
  const sql = await createTestDb(t, "repeat");
  await migrate(drizzle(sql), { migrationsFolder });
  const before = await sql`SELECT * FROM drizzle."__drizzle_migrations" ORDER BY id`;
  await migrate(drizzle(sql), { migrationsFolder });
  assert.deepEqual(await sql`SELECT * FROM drizzle."__drizzle_migrations" ORDER BY id`, before);
});

  // ─── 4. UPGRADE A: 0008->0030 ─────────────────────────────────────
test("upgrade 0008->0024 data preservation", async (t) => {
  const sql = await createTestDb(t, "upa");
  await migrate(drizzle(sql), { migrationsFolder: await buildPartialMigrationFolder(t, 8) });
  const [studio] = await sql`INSERT INTO studios (name,slug) VALUES ('UpA','upa') RETURNING id`;
  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-upa','T','upa@t.t',false,now(),now())`;
  const [client] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${studio.id},'Alice','Alice Upa','+39 333 1234567','new_lead','preserve') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (studio_id,display_name) VALUES (${studio.id},'MA') RETURNING id`;
  const [svc] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studio.id},'SA','brows','brows',8000,60,10) RETURNING id`;
  const [appt] = await sql`INSERT INTO appointments (studio_id,client_id,master_id,service_id,start_at,end_at,source,created_by_id,service_snapshot,client_snapshot,master_snapshot,price_snapshot_cents,duration_snapshot_minutes) VALUES (${studio.id},${client.id},${master.id},${svc.id},'2026-06-01 10:00','2026-06-01 11:00','other','u-upa','{}','{}','{}',8000,60) RETURNING id`;
  const [pay] = await sql`INSERT INTO payments (studio_id,client_id,appointment_id,total_amount_cents,balance_amount_cents) VALUES (${studio.id},${client.id},${appt.id},8000,8000) RETURNING id`;
  const [txn] = await sql`INSERT INTO payment_transactions (studio_id,client_id,payment_id,amount_cents,method,type,created_by_id) VALUES (${studio.id},${client.id},${pay.id},8000,'cash','full_payment','u-upa') RETURNING id`;
  
  await migrate(drizzle(sql), { migrationsFolder });
  assert.equal((await sql`SELECT count(*)::int AS c FROM drizzle."__drizzle_migrations"`)[0].c, 39);
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_templates`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_template_versions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consents`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consent_zones`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM calendar_exceptions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_sessions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_pigments`)[0].c, 0);

  // Studio preservation
  const [ps] = await sql`SELECT * FROM studios WHERE id=${studio.id}`;
  assert.equal(ps.name, "UpA");
  assert.equal(ps.slug, "upa");

  // User preservation
  const [pu] = await sql`SELECT * FROM "user" WHERE id='u-upa'`;
  assert.equal(pu.name, "T");
  assert.equal(pu.email, "upa@t.t");

  // Client preservation
  const [pc] = await sql`SELECT * FROM clients WHERE id=${client.id}`;
  assert.equal(pc.id, client.id);
  assert.equal(pc.studio_id, studio.id);
  assert.equal(pc.first_name, "Alice");
  assert.equal(pc.full_name, "Alice Upa");
  assert.equal(pc.phone, "+39 333 1234567");
  assert.equal(pc.client_status, "new_lead");
  assert.equal(pc.notes, "preserve");
  // Backfilled/computed fields from later migrations (0011, 0012)
  assert.equal(pc.phone_key, "+393331234567");
  assert.equal(pc.name_key, "alice upa");
  assert.equal(pc.whatsapp_key, null);
  assert.equal(pc.email_key, null);
  assert.equal(pc.instagram_key, null);

  // Master preservation
  const [pm] = await sql`SELECT * FROM masters WHERE id=${master.id}`;
  assert.equal(pm.id, master.id);
  assert.equal(pm.studio_id, studio.id);
  assert.equal(pm.display_name, "MA");

  // Service preservation
  const [psvc] = await sql`SELECT * FROM services WHERE id=${svc.id}`;
  assert.equal(psvc.id, svc.id);
  assert.equal(psvc.studio_id, studio.id);
  assert.equal(psvc.name, "SA");
  assert.equal(psvc.category, "brows");
  assert.equal(psvc.procedure_type, "brows");
  assert.equal(psvc.price_cents, 8000);
  assert.equal(psvc.duration_minutes, 60);
  assert.equal(psvc.buffer_before_minutes, 10);
  assert.equal(psvc.catalog_version, 0);
  assert.equal(psvc.price_mode, "legacy");

  // Appointment preservation
  const [pa] = await sql`SELECT * FROM appointments WHERE id=${appt.id}`;
  assert.equal(pa.id, appt.id);
  assert.equal(pa.studio_id, studio.id);
  assert.equal(pa.client_id, client.id);
  assert.equal(pa.master_id, master.id);
  assert.equal(pa.service_id, svc.id);
  assert.equal(new Date(pa.start_at).getTime(), new Date('2026-06-01 10:00').getTime());
  assert.equal(new Date(pa.end_at).getTime(), new Date('2026-06-01 11:00').getTime());
  assert.equal(pa.source, "other");
  assert.equal(pa.created_by_id, "u-upa");
  assert.equal(pa.price_snapshot_cents, 8000);
  assert.equal(pa.duration_snapshot_minutes, 60);
  assert.deepEqual(pa.service_snapshot, {});
  assert.deepEqual(pa.client_snapshot, {});
  assert.deepEqual(pa.master_snapshot, {});

  // Payment preservation
  const [ppay] = await sql`SELECT * FROM payments WHERE id=${pay.id}`;
  assert.equal(ppay.id, pay.id);
  assert.equal(ppay.studio_id, studio.id);
  assert.equal(ppay.client_id, client.id);
  assert.equal(ppay.appointment_id, appt.id);
  assert.equal(ppay.total_amount_cents, 8000);
  assert.equal(ppay.balance_amount_cents, 8000);

  // Payment Transaction preservation
  const [ptxn] = await sql`SELECT * FROM payment_transactions WHERE id=${txn.id}`;
  assert.equal(ptxn.id, txn.id);
  assert.equal(ptxn.studio_id, studio.id);
  assert.equal(ptxn.client_id, client.id);
  assert.equal(ptxn.payment_id, pay.id);
  assert.equal(ptxn.amount_cents, 8000);
  assert.equal(ptxn.method, "cash");
  assert.equal(ptxn.type, "full_payment");
  assert.equal(ptxn.created_by_id, "u-upa");
});

// ─── 5. UPGRADE B: 0013->0030 ─────────────────────────────────────
test("upgrade 0013->0024 data preservation", async (t) => {
  const sql = await createTestDb(t, "upb");
  await migrate(drizzle(sql), { migrationsFolder: await buildPartialMigrationFolder(t, 13) });
  const [studio] = await sql`INSERT INTO studios (name,slug) VALUES ('UpB','upb') RETURNING id`;
  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-upb','T','upb@t.t',false,now(),now())`;
  const [client] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${studio.id},'Bob','Bob Upb','+1 555 9876543','new_lead','upb') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (studio_id,display_name) VALUES (${studio.id},'MB') RETURNING id`;
  const [svc] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studio.id},'SB','brows','brows',5000,60,10) RETURNING id`;
  const [pr] = await sql`INSERT INTO master_price_revisions (studio_id,master_id,service_id,price_cents,revision,reason,approved_by_id) VALUES (${studio.id},${master.id},${svc.id},5000,1,'initial','u-upb') RETURNING id`;
  const [svc2] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studio.id},'SB2','lips','lips',3000,45,10) RETURNING id`;
  let offer, rev, item;
  await sql.begin(async tx => {
    [offer] = await tx`INSERT INTO custom_offers (studio_id,client_id) VALUES (${studio.id},${client.id}) RETURNING id`;
    [rev] = await tx`INSERT INTO offer_revisions (studio_id,offer_id,revision,standard_total_cents,discount_cents,agreed_total_cents,reason,approved_by_id) VALUES (${studio.id},${offer.id},1,8000,0,8000,'test','u-upb') RETURNING id`;
    [item] = await tx`INSERT INTO offer_items (studio_id,revision_id,service_id,service_name,zone_code,standard_cents,price_snapshot) VALUES (${studio.id},${rev.id},${svc.id},'SB','brows',5000,'{}') RETURNING id`;
    await tx`INSERT INTO offer_items (studio_id,revision_id,service_id,service_name,zone_code,standard_cents,price_snapshot) VALUES (${studio.id},${rev.id},${svc2.id},'SB2','lips',3000,'{}')`;
  });
  const [c2] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${studio.id},'Dup','Dup Upb','+1 555 1111111','new_lead','dup') RETURNING id`;
  const [mrg] = await sql`INSERT INTO client_merges (studio_id,target_id,source_id,actor_id,reason,review_token,target_snapshot,source_snapshot,result_snapshot,moved_records,provenance) VALUES (${studio.id},${client.id},${c2.id},'u-upb','test merge reason','tok','{}','{}','{}','{}','{}') RETURNING id`;
  
  await migrate(drizzle(sql), { migrationsFolder });
  assert.equal((await sql`SELECT count(*)::int AS c FROM drizzle."__drizzle_migrations"`)[0].c, 39);
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_templates`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_template_versions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consents`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consent_zones`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM calendar_exceptions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_sessions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_pigments`)[0].c, 0);

  // Clients preservation
  const [pc1] = await sql`SELECT * FROM clients WHERE id=${client.id}`;
  assert.equal(pc1.id, client.id);
  assert.equal(pc1.studio_id, studio.id);
  assert.equal(pc1.first_name, "Bob");
  assert.equal(pc1.full_name, "Bob Upb");
  assert.equal(pc1.phone_key, "+15559876543");
  assert.equal(pc1.name_key, "bob upb");

  const [pc2] = await sql`SELECT * FROM clients WHERE id=${c2.id}`;
  assert.equal(pc2.id, c2.id);
  assert.equal(pc2.studio_id, studio.id);
  assert.equal(pc2.first_name, "Dup");
  assert.equal(pc2.full_name, "Dup Upb");
  assert.equal(pc2.phone_key, "+15551111111");
  assert.equal(pc2.name_key, "dup upb");

  // Master and Services preservation
  const [pm] = await sql`SELECT * FROM masters WHERE id=${master.id}`;
  assert.equal(pm.id, master.id);
  assert.equal(pm.display_name, "MB");

  const [psvc1] = await sql`SELECT * FROM services WHERE id=${svc.id}`;
  assert.equal(psvc1.id, svc.id);
  assert.equal(psvc1.name, "SB");
  assert.equal(psvc1.price_cents, 5000);

  const [psvc2] = await sql`SELECT * FROM services WHERE id=${svc2.id}`;
  assert.equal(psvc2.id, svc2.id);
  assert.equal(psvc2.name, "SB2");
  assert.equal(psvc2.price_cents, 3000);

  // Pricing & Custom Offer preservation
  const [ppr] = await sql`SELECT * FROM master_price_revisions WHERE id=${pr.id}`;
  assert.equal(ppr.id, pr.id);
  assert.equal(ppr.studio_id, studio.id);
  assert.equal(ppr.master_id, master.id);
  assert.equal(ppr.service_id, svc.id);
  assert.equal(ppr.price_cents, 5000);
  assert.equal(ppr.revision, 1);
  assert.equal(ppr.reason, "initial");
  assert.equal(ppr.approved_by_id, "u-upb");

  const [poffer] = await sql`SELECT * FROM custom_offers WHERE id=${offer.id}`;
  assert.equal(poffer.id, offer.id);
  assert.equal(poffer.studio_id, studio.id);
  assert.equal(poffer.client_id, client.id);

  const [prev] = await sql`SELECT * FROM offer_revisions WHERE id=${rev.id}`;
  assert.equal(prev.id, rev.id);
  assert.equal(prev.studio_id, studio.id);
  assert.equal(prev.offer_id, offer.id);
  assert.equal(prev.revision, 1);
  assert.equal(prev.standard_total_cents, 8000);
  assert.equal(prev.discount_cents, 0);
  assert.equal(prev.agreed_total_cents, 8000);
  assert.equal(prev.reason, "test");
  assert.equal(prev.approved_by_id, "u-upb");

  const items = await sql`SELECT * FROM offer_items WHERE revision_id=${rev.id} ORDER BY standard_cents DESC`;
  assert.equal(items.length, 2);
  assert.equal(items[0].id, item.id);
  assert.equal(items[0].service_id, svc.id);
  assert.equal(items[0].service_name, "SB");
  assert.equal(items[0].zone_code, "brows");
  assert.equal(items[0].standard_cents, 5000);
  assert.equal(items[1].service_id, svc2.id);
  assert.equal(items[1].service_name, "SB2");
  assert.equal(items[1].zone_code, "lips");
  assert.equal(items[1].standard_cents, 3000);

  // Client Merge preservation
  const [pmrg] = await sql`SELECT * FROM client_merges WHERE id=${mrg.id}`;
  assert.equal(pmrg.id, mrg.id);
  assert.equal(pmrg.studio_id, studio.id);
  assert.equal(pmrg.target_id, client.id);
  assert.equal(pmrg.source_id, c2.id);
  assert.equal(pmrg.actor_id, "u-upb");
  assert.equal(pmrg.reason, "test merge reason");
  assert.equal(pmrg.review_token, "tok");
});

// ─── 6. UPGRADE C: 0019->0030 ─────────────────────────────────────
test("upgrade 0019->0024 cycle data preserved", async (t) => {
  const sql = await createTestDb(t, "upc");
  await migrate(drizzle(sql), { migrationsFolder: await buildPartialMigrationFolder(t, 19) });
  const s = await scaffold(sql, "UpC", "thinking");
  // Receipt: command='cycle.transition.v1', result->>'id'=cycle_id, result->>'version'=1
  const cmdId = crypto.randomUUID(); const reqKey = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'cycle.transition.v1',${reqKey},'h',${JSON.stringify({id:s.cycle.id,version:1})})`;
  const [hist] = await sql`INSERT INTO cycle_stage_history (studio_id,cycle_id,from_stage,to_stage,version,actor_id,command_id,reason) VALUES (${s.studio.id},${s.cycle.id},'new_lead','thinking',1,${s.userId},${cmdId},'transition test') RETURNING id`;
  
  await migrate(drizzle(sql), { migrationsFolder });
  assert.equal((await sql`SELECT count(*)::int AS c FROM drizzle."__drizzle_migrations"`)[0].c, 39);
  // 0021 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM medical_profile_revisions`)[0].c, 0);
  // 0022 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_medical_clearances`)[0].c, 0);
  // 0024 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_templates`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM consent_template_versions`)[0].c, 0);
  // 0025 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consents`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_consent_zones`)[0].c, 0);
  // 0027 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM calendar_exceptions`)[0].c, 0);
  // 0030 adds storage only: no historical backfill on upgrade
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_sessions`)[0].c, 0);
  assert.equal((await sql`SELECT count(*)::int AS c FROM procedure_pigments`)[0].c, 0);

  // Studio, User, Client, Master, Service preservation
  const [ps] = await sql`SELECT * FROM studios WHERE id=${s.studio.id}`;
  assert.equal(ps.id, s.studio.id);
  assert.equal(ps.name, "UpC");

  const [pu] = await sql`SELECT * FROM "user" WHERE id=${s.userId}`;
  assert.equal(pu.id, s.userId);
  assert.equal(pu.email, "upc@t.t");

  const [pc] = await sql`SELECT * FROM clients WHERE id=${s.client.id}`;
  assert.equal(pc.id, s.client.id);
  assert.equal(pc.studio_id, s.studio.id);
  assert.equal(pc.first_name, "UpC");
  assert.equal(pc.name_key, "upc upc");

  const [pm] = await sql`SELECT * FROM masters WHERE id=${s.master.id}`;
  assert.equal(pm.id, s.master.id);
  assert.equal(pm.display_name, "UpC M");

  const [psvc] = await sql`SELECT * FROM services WHERE id=${s.svc.id}`;
  assert.equal(psvc.id, s.svc.id);
  assert.equal(psvc.name, "UpC S");

  // Cycle preservation
  const [pcycle] = await sql`SELECT * FROM treatment_cycles WHERE id=${s.cycle.id}`;
  assert.equal(pcycle.id, s.cycle.id);
  assert.equal(pcycle.studio_id, s.studio.id);
  assert.equal(pcycle.client_id, s.client.id);
  assert.equal(pcycle.zone_code, "brows");
  assert.equal(pcycle.kind, "pmu");
  assert.equal(pcycle.stage, "thinking");

  // Command Receipt preservation
  const [prec] = await sql`SELECT * FROM command_receipts WHERE id=${cmdId}`;
  assert.equal(prec.id, cmdId);
  assert.equal(prec.studio_id, s.studio.id);
  assert.equal(prec.actor_id, s.userId);
  assert.equal(prec.command, "cycle.transition.v1");
  assert.equal(prec.request_key, reqKey);
  assert.equal(prec.payload_hash, "h");
  assert.deepEqual(prec.result, { id: s.cycle.id, version: 1 });

  // Cycle Stage History preservation
  const [phist] = await sql`SELECT * FROM cycle_stage_history WHERE id=${hist.id}`;
  assert.equal(phist.id, hist.id);
  assert.equal(phist.studio_id, s.studio.id);
  assert.equal(phist.cycle_id, s.cycle.id);
  assert.equal(phist.from_stage, "new_lead");
  assert.equal(phist.to_stage, "thinking");
  assert.equal(phist.version, 1);
  assert.equal(phist.actor_id, s.userId);
  assert.equal(phist.command_id, cmdId);
  assert.equal(phist.reason, "transition test");

  // Cycle Commercial Terms table is empty and operational
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_commercial_terms`)[0].c, 0);

  // Operational verification of 0020 on upgraded DB
  await sql.begin(async tx => {
    const termsId = crypto.randomUUID();
    const cmdId2 = crypto.randomUUID(); const rk2 = crypto.randomUUID();
    await tx`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId2},${s.studio.id},${s.userId},'cycle.terms-confirm.v1',${rk2},'h',${JSON.stringify({id:termsId,cycleId:s.cycle.id,revision:1})})`;
    await tx`INSERT INTO cycle_commercial_terms (id,studio_id,cycle_id,service_id,revision,cycle_version,source,source_snapshot,amount_cents,reason,review_at,actor_id,command_id) VALUES (${termsId},${s.studio.id},${s.cycle.id},${s.svc.id},1,1,'catalog','{"s":1}',5000,'upgrade test terms',now()+interval '30 days',${s.userId},${cmdId2})`;
  });
  assert.equal((await sql`SELECT count(*)::int AS c FROM cycle_commercial_terms WHERE cycle_id=${s.cycle.id}`)[0].c, 1);
});

// ─── 7. DEDUP ──────────────────────────────────────────────────────
test("dedup normalization exact", async (t) => {
  const sql = await createTestDb(t, "dedup");
  await migrate(drizzle(sql), { migrationsFolder });
  assert.equal((await sql`SELECT pmu_phone_key('+1 (234) 567-8900') AS k`)[0].k, "+12345678900");
  assert.equal((await sql`SELECT pmu_phone_key('not a phone') AS k`)[0].k, null);
  assert.equal((await sql`SELECT pmu_email_key('  Alice@Example.COM  ') AS k`)[0].k, "alice@example.com");
  assert.equal((await sql`SELECT pmu_email_key('nope') AS k`)[0].k, null);
  assert.equal((await sql`SELECT pmu_instagram_key('@Alice_PMU') AS k`)[0].k, "alice_pmu");
  assert.equal((await sql`SELECT pmu_name_key('  Alice  Test  ') AS k`)[0].k, "alice test");
});

// ─── 8. PRICING/OFFER IMMUTABILITY (0010) ─────────────────────────
test("pricing/offer immutability", async (t) => {
  const sql = await createTestDb(t, "imm10");
  await migrate(drizzle(sql), { migrationsFolder });
  const [st] = await sql`INSERT INTO studios (name,slug) VALUES ('Im','im') RETURNING id`;
  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-im','T','im@t.t',false,now(),now())`;
  const [ma] = await sql`INSERT INTO masters (studio_id,display_name) VALUES (${st.id},'M') RETURNING id`;
  const [cl] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${st.id},'I','II','+11100','new_lead','') RETURNING id`;
  const [sv] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${st.id},'S','brows','brows',10000,60,10) RETURNING id`;
  const [pr] = await sql`INSERT INTO master_price_revisions (studio_id,master_id,service_id,price_cents,revision,reason,approved_by_id) VALUES (${st.id},${ma.id},${sv.id},10000,1,'init','u-im') RETURNING id`;
  await assert.rejects(sql`UPDATE master_price_revisions SET price_cents=1 WHERE id=${pr.id}`, /immutable/i);
  const [sv2] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${st.id},'S2','lips','lips',5000,60,10) RETURNING id`;
  let rev, item;
  await sql.begin(async tx => {
    const [of] = await tx`INSERT INTO custom_offers (studio_id,client_id) VALUES (${st.id},${cl.id}) RETURNING id`;
    [rev] = await tx`INSERT INTO offer_revisions (studio_id,offer_id,revision,standard_total_cents,discount_cents,agreed_total_cents,reason,approved_by_id) VALUES (${st.id},${of.id},1,15000,0,15000,'test','u-im') RETURNING id`;
    [item] = await tx`INSERT INTO offer_items (studio_id,revision_id,service_id,service_name,zone_code,standard_cents,price_snapshot) VALUES (${st.id},${rev.id},${sv.id},'S','brows',10000,'{}') RETURNING id`;
    await tx`INSERT INTO offer_items (studio_id,revision_id,service_id,service_name,zone_code,standard_cents,price_snapshot) VALUES (${st.id},${rev.id},${sv2.id},'S2','lips',5000,'{}')`;
  });
  await assert.rejects(sql`UPDATE offer_revisions SET agreed_total_cents=1 WHERE id=${rev.id}`, /immutable/i);
  await assert.rejects(sql`UPDATE offer_items SET standard_cents=1 WHERE id=${item.id}`, /immutable|creation/i);
});

// ─── 9. MERGE IMMUTABLE (0013) ────────────────────────────────────
test("merge immutable", async (t) => {
  const sql = await createTestDb(t, "mrg");
  await migrate(drizzle(sql), { migrationsFolder });
  const [st] = await sql`INSERT INTO studios (name,slug) VALUES ('Mg','mg') RETURNING id`;
  const [c1] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${st.id},'A','AA','+11101','new_lead','') RETURNING id`;
  const [c2] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${st.id},'B','BB','+22201','new_lead','') RETURNING id`;
  const [m] = await sql`INSERT INTO client_merges (studio_id,target_id,source_id,actor_id,reason,review_token,target_snapshot,source_snapshot,result_snapshot,moved_records,provenance) VALUES (${st.id},${c1.id},${c2.id},'act','merge reason text','tok','{}','{}','{}','{}','{}') RETURNING id`;
  await assert.rejects(sql`UPDATE client_merges SET reason='x' WHERE id=${m.id}`, /immutable/i);
});

// ─── 10. CROSS-STUDIO (0014) ──────────────────────────────────────
test("cross-studio cycle rejected", async (t) => {
  const sql = await createTestDb(t, "xst");
  await migrate(drizzle(sql), { migrationsFolder });
  const [s1] = await sql`INSERT INTO studios (name,slug) VALUES ('S1','s1x') RETURNING id`;
  const [s2] = await sql`INSERT INTO studios (name,slug) VALUES ('S2','s2x') RETURNING id`;
  const [c2] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status,notes) VALUES (${s2.id},'X','XX','+33301','new_lead','') RETURNING id`;
  await assert.rejects(sql`INSERT INTO treatment_cycles (studio_id,client_id,zone_code,kind,stage) VALUES (${s1.id},${c2.id},'brows','pmu','new_lead')`, /foreign key|studio|validate/i);
});

// ─── 11. CYCLE HISTORY IMMUTABLE (0015) ───────────────────────────
test("cycle history immutable", async (t) => {
  const sql = await createTestDb(t, "ch");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "CH", "new_lead");
  const cmdId = crypto.randomUUID(); const rk = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'cycle.transition.v1',${rk},'h',${JSON.stringify({id:s.cycle.id,version:1})})`;
  const [h] = await sql`INSERT INTO cycle_stage_history (studio_id,cycle_id,from_stage,to_stage,version,actor_id,command_id,reason) VALUES (${s.studio.id},${s.cycle.id},'new_lead','qualification',1,${s.userId},${cmdId},'qualification reason') RETURNING id`;
  await assert.rejects(sql`UPDATE cycle_stage_history SET to_stage='x' WHERE id=${h.id}`, /immutable/i);
  assert.equal((await sql`SELECT to_stage FROM cycle_stage_history WHERE id=${h.id}`)[0].to_stage, "qualification");
});

// ─── 12. CONSULTATION IMMUTABLE (0016) ────────────────────────────
test("consultation immutable", async (t) => {
  const sql = await createTestDb(t, "co");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "CO", "consultation_scheduled");
  const appt = await makeConsultationVisit(sql, s);
  const [cons] = await sql`INSERT INTO consultations (cycle_id,studio_id,appointment_id,master_id,completed_at,completed_by,completion_reason,decision_due_at) VALUES (${s.cycle.id},${s.studio.id},${appt.id},${s.master.id},now(),${s.userId},'completed',now()+interval '7 days') RETURNING id`;
  await assert.rejects(sql`UPDATE consultations SET completion_reason='x' WHERE id=${cons.id}`, /immutable/i);
});

// ─── 13. QUALIFICATION IMMUTABLE (0016) ───────────────────────────
test("qualification immutable", async (t) => {
  const sql = await createTestDb(t, "qu");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "QU", "qualification");
  const cmdId = crypto.randomUUID(); const rk = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'cycle.qualify.v1',${rk},'h',${JSON.stringify({id:s.cycle.id,fromVersion:0,version:1})})`;
  const [q] = await sql`INSERT INTO cycle_qualifications (studio_id,cycle_id,cycle_version,evidence,reason,consultation_required,evaluation_required,condition_changed,other_master_pmu,doubt,actor_id,command_id) VALUES (${s.studio.id},${s.cycle.id},1,'{"skin":"ok"}','qualification reason',false,false,false,false,false,${s.userId},${cmdId}) RETURNING id`;
  await assert.rejects(sql`UPDATE cycle_qualifications SET reason='x' WHERE id=${q.id}`, /immutable/i);
});

// ─── 14. FOLLOW-UP REVISION IMMUTABLE (0018) ─────────────────────
test("follow-up revision immutable", async (t) => {
  const sql = await createTestDb(t, "fu");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "FU", "consultation_scheduled");
  const appt = await makeConsultationVisit(sql, s);
  const [cons] = await sql`INSERT INTO consultations (cycle_id,studio_id,appointment_id,master_id,completed_at,completed_by,completion_reason,decision_due_at) VALUES (${s.cycle.id},${s.studio.id},${appt.id},${s.master.id},now(),${s.userId},'completed',now()+interval '7 days') RETURNING id`;
  const cmdId1 = crypto.randomUUID(); const rk1 = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId1},${s.studio.id},${s.userId},'consultation.result.v1',${rk1},'h',${JSON.stringify({id:s.cycle.id,fromVersion:0,version:1})})`;
  const [result] = await sql`INSERT INTO consultation_results (studio_id,consultation_id,outcome,reason,comment,follow_up_at,actor_id,command_id) VALUES (${s.studio.id},${cons.id},'client_thinking','follow up reason','follow up comment',now()+interval '7 days',${s.userId},${cmdId1}) RETURNING id`;
  // follow_up_revision_guard: command='cycle.follow-up-reschedule.v1', result->>'revisionId'=rev.id, result->>'id'=cycle_id
  // Deferred trigger: insert rev first in tx, create receipt with rev.id, commit
  await sql.begin(async tx => {
    const revId = crypto.randomUUID();
    const cmdId2 = crypto.randomUUID(); const rk2 = crypto.randomUUID();
    await tx`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId2},${s.studio.id},${s.userId},'cycle.follow-up-reschedule.v1',${rk2},'h',${JSON.stringify({revisionId:revId,id:s.cycle.id})})`;
    await tx`INSERT INTO follow_up_revisions (id,studio_id,result_id,sequence,due_at,reason,comment,actor_id,command_id) VALUES (${revId},${s.studio.id},${result.id},1,now()+interval '14 days','reschedule reason','comment text',${s.userId},${cmdId2})`;
  });
  const [rev] = await sql`SELECT id FROM follow_up_revisions WHERE result_id=${result.id}`;
  await assert.rejects(sql`UPDATE follow_up_revisions SET reason='x' WHERE id=${rev.id}`, /immutable/i);
});

// ─── 15. CYCLE REVIEW IMMUTABLE (0019) ────────────────────────────
test("cycle review immutable", async (t) => {
  const sql = await createTestDb(t, "cr");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "CR", "thinking");
  const appt = await makeConsultationVisit(sql, s);
  const [cons] = await sql`INSERT INTO consultations (cycle_id,studio_id,appointment_id,master_id,completed_at,completed_by,completion_reason,decision_due_at) VALUES (${s.cycle.id},${s.studio.id},${appt.id},${s.master.id},now(),${s.userId},'completed',now()+interval '7 days') RETURNING id`;
  const cmdId1 = crypto.randomUUID(); const rk1 = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId1},${s.studio.id},${s.userId},'consultation.result.v1',${rk1},'h',${JSON.stringify({id:s.cycle.id,fromVersion:0,version:1})})`;
  const [result] = await sql`INSERT INTO consultation_results (studio_id,consultation_id,outcome,reason,comment,follow_up_at,actor_id,command_id) VALUES (${s.studio.id},${cons.id},'client_thinking','thinking reason','thinking comment',now()+interval '7 days',${s.userId},${cmdId1}) RETURNING id`;
  // cycle_review_guard: command='cycle.review.v1', result->>'reviewId'=rev.id, result->>'id'=cycle_id
  await sql.begin(async tx => {
    const revId = crypto.randomUUID();
    const cmdId = crypto.randomUUID(); const rk = crypto.randomUUID();
    await tx`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'cycle.review.v1',${rk},'h',${JSON.stringify({reviewId:revId,id:s.cycle.id})})`;
    await tx`INSERT INTO cycle_reviews (id,studio_id,cycle_id,result_id,operation,reason,comment,actor_id,command_id) VALUES (${revId},${s.studio.id},${s.cycle.id},${result.id},'lost','lost reason text','review comment',${s.userId},${cmdId})`;
  });
  const [rev] = await sql`SELECT id FROM cycle_reviews WHERE cycle_id=${s.cycle.id}`;
  await assert.rejects(sql`UPDATE cycle_reviews SET reason='x' WHERE id=${rev.id}`, /immutable/i);
});

// ─── 16. COMMERCIAL TERMS IMMUTABLE (0020) ────────────────────────
test("commercial terms immutable", async (t) => {
  const sql = await createTestDb(t, "ct");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "CT", "awaiting_acconto");
  // commercial_terms_guard: command='cycle.terms-confirm.v1', result->>'id'=terms.id, result->>'cycleId'=cycle_id, result->>'revision'=1
  await sql.begin(async tx => {
    const termsId = crypto.randomUUID();
    const cmdId = crypto.randomUUID(); const rk = crypto.randomUUID();
    await tx`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'cycle.terms-confirm.v1',${rk},'h',${JSON.stringify({id:termsId,cycleId:s.cycle.id,revision:1})})`;
    await tx`INSERT INTO cycle_commercial_terms (id,studio_id,cycle_id,service_id,revision,cycle_version,source,source_snapshot,amount_cents,reason,review_at,actor_id,command_id) VALUES (${termsId},${s.studio.id},${s.cycle.id},${s.svc.id},1,1,'catalog','{"s":1}',5000,'catalog terms reason',now()+interval '30 days',${s.userId},${cmdId})`;
  });
  const [terms] = await sql`SELECT id FROM cycle_commercial_terms WHERE cycle_id=${s.cycle.id}`;
  await assert.rejects(sql`UPDATE cycle_commercial_terms SET reason='x' WHERE id=${terms.id}`, /immutable/i);
});

// ─── 17. FOLLOW-UP CLOSURE IMMUTABLE (0019) ──────────────────────
test("follow-up closure immutable", async (t) => {
  const sql = await createTestDb(t, "fc");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "FC", "consultation_scheduled");
  const appt = await makeConsultationVisit(sql, s);
  const [cons] = await sql`INSERT INTO consultations (cycle_id,studio_id,appointment_id,master_id,completed_at,completed_by,completion_reason,decision_due_at) VALUES (${s.cycle.id},${s.studio.id},${appt.id},${s.master.id},now(),${s.userId},'completed',now()+interval '7 days') RETURNING id`;
  const cmdId = crypto.randomUUID(); const rk = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (id,studio_id,actor_id,command,request_key,payload_hash,result) VALUES (${cmdId},${s.studio.id},${s.userId},'consultation.result.v1',${rk},'h',${JSON.stringify({id:s.cycle.id,fromVersion:0,version:1})})`;
  const [result] = await sql`INSERT INTO consultation_results (studio_id,consultation_id,outcome,reason,comment,follow_up_at,actor_id,command_id) VALUES (${s.studio.id},${cons.id},'client_thinking','follow up reason','follow up comment',now()+interval '7 days',${s.userId},${cmdId}) RETURNING id`;
  const [closure] = await sql`INSERT INTO follow_up_closures (studio_id,result_id,reason,actor_id) VALUES (${s.studio.id},${result.id},'cycle_left_branch',${s.userId}) RETURNING id`;
  await assert.rejects(sql`UPDATE follow_up_closures SET reason='x' WHERE id=${closure.id}`, /immutable/i);
});

// ─── 18. PROCEDURE EXECUTION (0030) ────────────────────────────────
test("procedure execution lifecycle & constraints (0030)", async (t) => {
  const sql = await createTestDb(t, "proc30");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "Proc", "procedure_confirmed");
  const appt = await makeConsultationVisit(sql, s);

  // 1. Status check constraint rejects invalid statuses
  await assert.rejects(
    sql`INSERT INTO procedure_sessions (
      studio_id, client_id, master_id, service_id, cycle_id, procedure_area, procedure_type, session_type, status
    ) VALUES (
      ${s.studio.id}, ${s.client.id}, ${s.master.id}, ${s.svc.id}, ${s.cycle.id}, 'brows', 'brows', 'primary_session', 'INVALID_STATUS'
    )`,
    /procedure_sessions_status_check|check/i
  );

  // 2. Insert valid session in IN_PROGRESS
  const cmdId1 = crypto.randomUUID();
  const [sess1] = await sql`INSERT INTO procedure_sessions (
    studio_id, client_id, master_id, service_id, cycle_id, appointment_id, procedure_area, procedure_type, session_type, status, started_at, command_id
  ) VALUES (
    ${s.studio.id}, ${s.client.id}, ${s.master.id}, ${s.svc.id}, ${s.cycle.id}, ${appt.id}, 'brows', 'brows', 'primary_session', 'IN_PROGRESS', now(), ${cmdId1}
  ) RETURNING id`;
  assert.ok(sess1.id);

  // 3. Partial unique index prevents duplicate active procedure on same cycle
  const cmdId2 = crypto.randomUUID();
  await assert.rejects(
    sql`INSERT INTO procedure_sessions (
      studio_id, client_id, master_id, service_id, cycle_id, procedure_area, procedure_type, session_type, status, started_at, command_id
    ) VALUES (
      ${s.studio.id}, ${s.client.id}, ${s.master.id}, ${s.svc.id}, ${s.cycle.id}, 'brows', 'brows', 'primary_session', 'IN_PROGRESS', now(), ${cmdId2}
    )`,
    /procedure_sessions_active_cycle_unique|unique/i
  );

  // 4. Command ID uniqueness
  await assert.rejects(
    sql`INSERT INTO procedure_sessions (
      studio_id, client_id, master_id, service_id, cycle_id, procedure_area, procedure_type, session_type, status, command_id
    ) VALUES (
      ${s.studio.id}, ${s.client.id}, ${s.master.id}, ${s.svc.id}, ${s.cycle.id}, 'brows', 'brows', 'primary_session', 'PLANNED', ${cmdId1}
    )`,
    /procedure_sessions_command_unique|unique/i
  );

  // 5. Transition to COMPLETED with command receipt and verify cycle stage receipt check
  const completeCmdId = crypto.randomUUID();
  const reqKey = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (
    id, studio_id, actor_id, command, request_key, payload_hash, result
  ) VALUES (
    ${completeCmdId}, ${s.studio.id}, ${s.userId}, 'procedure.complete.v1', ${reqKey}, 'h',
    ${JSON.stringify({ id: sess1.id, cycleId: s.cycle.id, fromStage: "procedure_confirmed", toStage: "first_session_completed", fromVersion: 0, version: 1 })}
  )`;

  await sql`UPDATE procedure_sessions SET status='COMPLETED', completed_at=now() WHERE id=${sess1.id}`;
  const [stageHist] = await sql`INSERT INTO cycle_stage_history (
    studio_id, cycle_id, from_stage, to_stage, version, actor_id, command_id, reason
  ) VALUES (
    ${s.studio.id}, ${s.cycle.id}, 'procedure_confirmed', 'first_session_completed', 1, ${s.userId}, ${completeCmdId}, 'Procedure completed'
  ) RETURNING id`;
  assert.ok(stageHist.id);

  // 6. Access log & Audit log checks accept procedure operations
  const [accLog] = await sql`INSERT INTO access_logs (
    studio_id, actor_id, operation, target_id, result, record_ids, record_count
  ) VALUES (
    ${s.studio.id}, ${s.userId}, 'procedures.list', ${sess1.id}, 'returned', ${JSON.stringify([sess1.id])}, 1
  ) RETURNING id`;
  assert.ok(accLog.id);

  const [audLog] = await sql`INSERT INTO audit_logs (
    studio_id, user_id, action, entity_type, entity_id, reason, reason_source, old_values, new_values, contract_version
  ) VALUES (
    ${s.studio.id}, ${s.userId}, 'procedure_completed', 'procedure_session', ${sess1.id}, 'Procedure finished safely', 'command', '{}', '{"status":"COMPLETED"}', 1
  ) RETURNING id`;
  assert.ok(audLog.id);
});

// ─── 19. TOTAL FACE & REMOVER (0031) ────────────────────────────────
test("total face packages & remover lifecycle & constraints (0031)", async (t) => {
  const sql = await createTestDb(t, "tf31");
  await migrate(drizzle(sql), { migrationsFolder });
  const s = await scaffold(sql, "TF", "new_lead");

  // 1. Create Total Face package
  const [pkg] = await sql`INSERT INTO treatment_packages (
    studio_id, client_id, kind, status, created_by_id
  ) VALUES (
    ${s.studio.id}, ${s.client.id}, 'total_face', 'active', ${s.userId}
  ) RETURNING id, status`;
  assert.equal(pkg.status, "active");

  // 2. Create sibling cycles for package
  const [cycleLips] = await sql`INSERT INTO treatment_cycles (
    studio_id, client_id, zone_code, kind, stage, package_id
  ) VALUES (
    ${s.studio.id}, ${s.client.id}, 'lips', 'pmu', 'new_lead', ${pkg.id}
  ) RETURNING id`;
  assert.ok(cycleLips.id);

  // 3. Command receipt for total-face.create.v1 and cycle_stage_history
  const tfCmdId = crypto.randomUUID();
  const tfReqKey = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (
    id, studio_id, actor_id, command, request_key, payload_hash, result
  ) VALUES (
    ${tfCmdId}, ${s.studio.id}, ${s.userId}, 'total-face.create.v1', ${tfReqKey}, 'hash1',
    ${JSON.stringify({ id: pkg.id, cycleIds: [s.cycle.id, cycleLips.id] })}
  )`;

  const [histTf] = await sql`INSERT INTO cycle_stage_history (
    studio_id, cycle_id, from_stage, to_stage, version, actor_id, command_id, reason
  ) VALUES (
    ${s.studio.id}, ${cycleLips.id}, null, 'new_lead', 1, ${s.userId}, ${tfCmdId}, 'Total Face package created'
  ) RETURNING id`;
  assert.ok(histTf.id);

  // 4. Create Remover cycle and stage history with remover.create.v1 receipt
  const [removerCycle] = await sql`INSERT INTO treatment_cycles (
    studio_id, client_id, zone_code, kind, stage, origin_cycle_id
  ) VALUES (
    ${s.studio.id}, ${s.client.id}, 'brows', 'remover', 'new_lead', ${s.cycle.id}
  ) RETURNING id`;
  assert.ok(removerCycle.id);

  const remCmdId = crypto.randomUUID();
  const remReqKey = crypto.randomUUID();
  await sql`INSERT INTO command_receipts (
    id, studio_id, actor_id, command, request_key, payload_hash, result
  ) VALUES (
    ${remCmdId}, ${s.studio.id}, ${s.userId}, 'remover.create.v1', ${remReqKey}, 'hash2',
    ${JSON.stringify({ id: removerCycle.id, version: 1 })}
  )`;

  const [histRem] = await sql`INSERT INTO cycle_stage_history (
    studio_id, cycle_id, from_stage, to_stage, version, actor_id, command_id, reason
  ) VALUES (
    ${s.studio.id}, ${removerCycle.id}, null, 'new_lead', 1, ${s.userId}, ${remCmdId}, 'Remover cycle created'
  ) RETURNING id`;
  assert.ok(histRem.id);

  // 5. Audit logs for total face and remover
  const [audPkg] = await sql`INSERT INTO audit_logs (
    studio_id, user_id, action, entity_type, entity_id, reason, reason_source, old_values, new_values, contract_version
  ) VALUES (
    ${s.studio.id}, ${s.userId}, 'total_face_package_created', 'treatment_package', ${pkg.id}, 'Total Face package initialized', 'command', '{}', '{"status":"active"}', 1
  ) RETURNING id`;
  assert.ok(audPkg.id);

  const [audRem] = await sql`INSERT INTO audit_logs (
    studio_id, user_id, action, entity_type, entity_id, reason, reason_source, old_values, new_values, contract_version
  ) VALUES (
    ${s.studio.id}, ${s.userId}, 'remover_cycle_created', 'treatment_cycle', ${removerCycle.id}, 'Remover cycle initialized', 'command', '{}', '{"stage":"new_lead"}', 1
  ) RETURNING id`;
  assert.ok(audRem.id);

  // 6. Access logs
  const [accPkg] = await sql`INSERT INTO access_logs (
    studio_id, actor_id, operation, target_id, result, record_ids, record_count
  ) VALUES (
    ${s.studio.id}, ${s.userId}, 'packages.list', ${pkg.id}, 'returned', ${JSON.stringify([pkg.id])}, 1
  ) RETURNING id`;
  assert.ok(accPkg.id);
});

// ─── 20. DETERMINISTIC SCHEMA DRIFT VERIFICATION ──────────────────
test("deterministic schema drift verification against 0038_snapshot.json", async (t) => {
  const sql = await createTestDb(t, "drift");
  await migrate(drizzle(sql), { migrationsFolder });

  // 1. Verify migration head
  const migrationHistory = await sql`SELECT * FROM drizzle."__drizzle_migrations" ORDER BY id`;
  assert.equal(migrationHistory.length, 39, "Migration history must contain exactly 39 entries");
  const migrationFiles = readMigrationFiles({ migrationsFolder });
  assert.equal(migrationFiles.length, 39);
  assert.equal(migrationHistory[38].hash, migrationFiles[38].hash, "Migration head hash must match 0038 migration file hash");
  const journal = await readJson(path.join(migrationsFolder, "meta/_journal.json"));
  assert.equal(journal.entries[38].tag, "0038_freezing_spyke", "Migration head tag must be 0038_freezing_spyke");

  const snap = await readJson(path.join(migrationsFolder, "meta/0038_snapshot.json"));
  assert.ok(Object.values(snap.tables).some(t => t.name === "privacy_requests"), "0038 snapshot must define privacy_requests");
  assert.ok(Object.values(snap.tables).some(t => t.name === "studio_privacy_retention_policies"), "0038 snapshot must define studio_privacy_retention_policies");
  assert.ok(Object.values(snap.tables).some(t => t.name === "worker_heartbeats"), "0037 snapshot must define worker_heartbeats");
  assert.ok(Object.values(snap.tables).some(t => t.name === "handoffs"), "0036 snapshot must define handoffs");
  assert.ok(Object.values(snap.tables).some(t => t.name === "ai_runs"), "0035 snapshot must define ai_runs");
  assert.ok(Object.values(snap.tables).some(t => t.name === "google_calendar_connections"), "0035 snapshot must define google_calendar_connections");
  assert.ok(Object.values(snap.tables).some(t => t.name === "google_calendar_event_mappings"), "0035 snapshot must define google_calendar_event_mappings");
  assert.ok(Object.values(snap.tables).some(t => t.name === "automation_rules"), "0034 snapshot must define automation_rules");
  assert.ok(Object.values(snap.tables).some(t => t.name === "automation_executions"), "0034 snapshot must define automation_executions");
  assert.ok(Object.values(snap.tables).some(t => t.name === "conversations"), "0034 snapshot must define conversations");
  assert.ok(Object.values(snap.tables).some(t => t.name === "conversation_messages"), "0034 snapshot must define conversation_messages");
  assert.ok(Object.values(snap.tables).some(t => t.name === "conversation_read_states"), "0034 snapshot must define conversation_read_states");
  assert.ok(Object.values(snap.tables).some(t => t.name === "medical_profile_revisions"), "0030 snapshot must define medical_profile_revisions");
  assert.ok(Object.values(snap.tables).some(t => t.name === "cycle_medical_clearances"), "0030 snapshot must define cycle_medical_clearances");
  assert.ok(Object.values(snap.tables).some(t => t.name === "ledger_entries"), "0030 snapshot must define ledger_entries");
  assert.ok(Object.values(snap.tables).some(t => t.name === "consent_templates"), "0030 snapshot must define consent_templates");
  assert.ok(Object.values(snap.tables).some(t => t.name === "consent_template_versions"), "0030 snapshot must define consent_template_versions");
  assert.ok(Object.values(snap.tables).some(t => t.name === "cycle_consents"), "0030 snapshot must define cycle_consents");
  assert.ok(Object.values(snap.tables).some(t => t.name === "cycle_consent_zones"), "0030 snapshot must define cycle_consent_zones");
  assert.ok(Object.values(snap.tables).some(t => t.name === "calendar_exceptions"), "0030 snapshot must define calendar_exceptions");
  assert.ok(Object.values(snap.tables).some(t => t.name === "procedure_sessions"), "0030 snapshot must define procedure_sessions");
  assert.ok(Object.values(snap.tables).some(t => t.name === "procedure_pigments"), "0030 snapshot must define procedure_pigments");

  let trueDriftCount = 0;
  let normalizationDiffCount = 0;
  const trueDriftDetails = [];
  const manualSqlObjects = [];

  // Helper for action type mapping
  const pgActionToDrizzle = (act) => {
    switch (act) {
      case "a": return "no action";
      case "r": return "restrict";
      case "c": return "cascade";
      case "n": return "set null";
      case "d": return "set default";
      default: return act;
    }
  };

  // Normalization for data types
  const normalizePgType = (dataType, udtName) => {
    const dt = (dataType || "").toLowerCase();
    const udt = (udtName || "").toLowerCase();
    if (dt === "character varying" || dt === "varchar") return "varchar";
    if (dt === "timestamp without time zone" || dt === "timestamp") return "timestamp";
    if (dt === "time without time zone" || dt === "time") return "time";
    if (dt === "array" && udt === "_text") return "text[]";
    if (dt === "user-defined") return udt;
    return dt;
  };

  // ── A. TABLES ──────────────────────────────────────────────────
  const pgTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const actualTableNames = new Set(pgTables.map(r => r.table_name));
  const expectedTableNames = new Set(Object.values(snap.tables).map(t => t.name));

  for (const exp of expectedTableNames) {
    if (!actualTableNames.has(exp)) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "TABLE", object: exp, error: "Missing table in PostgreSQL public schema" });
    }
  }
  for (const act of actualTableNames) {
    if (!expectedTableNames.has(act)) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "TABLE", object: act, error: "Unexpected table in PostgreSQL public schema" });
    }
  }

  // ── B. COLUMNS ─────────────────────────────────────────────────
  const pgCols = await sql`
    SELECT 
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.column_name
  `;
  const pgColMap = new Map();
  for (const c of pgCols) {
    pgColMap.set(`${c.table_name}.${c.column_name}`, c);
  }

  let columnsCompared = 0;
  for (const table of Object.values(snap.tables)) {
    for (const snapCol of Object.values(table.columns)) {
      columnsCompared++;
      const fullKey = `${table.name}.${snapCol.name}`;
      const pgCol = pgColMap.get(fullKey);

      if (!pgCol) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "COLUMN", object: fullKey, error: "Missing column in PostgreSQL" });
        continue;
      }

      // Nullable comparison
      const expectedNullable = !snapCol.notNull;
      const actualNullable = pgCol.is_nullable === "YES";
      if (expectedNullable !== actualNullable) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "COLUMN_NULLABLE", object: fullKey, expected: expectedNullable, actual: actualNullable });
      }

      // Data type comparison
      let expType = (snapCol.type || "").toLowerCase();
      if (expType.startsWith("varchar")) expType = "varchar";
      const normActualType = normalizePgType(pgCol.data_type, pgCol.udt_name);

      if (expType !== normActualType && expType !== pgCol.udt_name.toLowerCase()) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "COLUMN_TYPE", object: fullKey, expected: snapCol.type, actual: pgCol.data_type, udt: pgCol.udt_name });
      } else if (snapCol.type.toLowerCase() !== pgCol.data_type.toLowerCase()) {
        normalizationDiffCount++;
      }

      // Default expression presence & semantics
      if (snapCol.default !== undefined) {
        if (!pgCol.column_default) {
          trueDriftCount++;
          trueDriftDetails.push({ category: "COLUMN_DEFAULT", object: fullKey, error: `Missing default: expected ${snapCol.default}` });
        } else {
          normalizationDiffCount++;
        }
      }
    }
  }

  // ── C. PRIMARY KEYS ────────────────────────────────────────────
  const pgPks = await sql`
    SELECT 
      tc.table_name,
      ARRAY_AGG(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
    GROUP BY tc.table_name
    ORDER BY tc.table_name
  `;
  const pgPkMap = new Map(pgPks.map(r => [r.table_name, r.columns]));

  let primaryKeysCompared = 0;
  for (const table of Object.values(snap.tables)) {
    primaryKeysCompared++;
    const snapPkCols = [];
    for (const col of Object.values(table.columns)) {
      if (col.primaryKey) snapPkCols.push(col.name);
    }
    for (const cpk of Object.values(table.compositePrimaryKeys || {})) {
      snapPkCols.push(...cpk.columns);
    }

    const actualCols = pgPkMap.get(table.name);
    if (!actualCols) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "PRIMARY_KEY", object: table.name, error: "Missing PK on table in PostgreSQL" });
    } else if (JSON.stringify(snapPkCols) !== JSON.stringify(actualCols)) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "PRIMARY_KEY", object: table.name, expected: snapPkCols, actual: actualCols });
    }
  }

  // ── D. FOREIGN KEYS ────────────────────────────────────────────
  const pgFks = await sql`
    SELECT
      con.conname AS constraint_name,
      cl.relname AS child_table,
      ARRAY_AGG(att.attname ORDER BY u.pos) AS child_columns,
      clf.relname AS referenced_table,
      ARRAY_AGG(attf.attname ORDER BY u.pos) AS referenced_columns,
      con.confdeltype,
      con.confupdtype
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_class clf ON con.confrelid = clf.oid
    JOIN pg_namespace n ON con.connamespace = n.oid
    JOIN LATERAL UNNEST(con.conkey, con.confkey) WITH ORDINALITY AS u(attnum, fattnum, pos) ON TRUE
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
    JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = u.fattnum
    WHERE n.nspname = 'public' AND con.contype = 'f'
    GROUP BY con.conname, cl.relname, clf.relname, con.confdeltype, con.confupdtype
    ORDER BY cl.relname, con.conname
  `;
  const pgFkMap = new Map();
  for (const fk of pgFks) {
    const key = `${fk.child_table}(${fk.child_columns.join(",")})->${fk.referenced_table}(${fk.referenced_columns.join(",")})`;
    pgFkMap.set(key, fk);
  }

  const snapFkMap = new Map();
  for (const table of Object.values(snap.tables)) {
    for (const [fkName, fk] of Object.entries(table.foreignKeys || {})) {
      const key = `${fk.tableFrom}(${fk.columnsFrom.join(",")})->${fk.tableTo}(${fk.columnsTo.join(",")})`;
      snapFkMap.set(key, { ...fk, name: fkName });
    }
  }

  // Known intentionally manual SQL deferrable foreign keys
  const manualFkSet = new Set([
    "consultation_results(command_id)->command_receipts(id)",
    "cycle_commercial_terms(command_id)->command_receipts(id)",
    "cycle_qualifications(command_id)->command_receipts(id)",
    "cycle_reviews(command_id)->command_receipts(id)",
    "follow_up_revisions(command_id)->command_receipts(id)",
    "tasks(consultation_id,studio_id)->consultations(id,studio_id)"
  ]);

  let foreignKeysCompared = 0;
  for (const [key, snapFk] of snapFkMap.entries()) {
    foreignKeysCompared++;
    const pgFk = pgFkMap.get(key);
    if (!pgFk) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "FOREIGN_KEY", object: key, error: "Missing FK in PostgreSQL" });
    } else {
      const actualOnDelete = pgActionToDrizzle(pgFk.confdeltype);
      const actualOnUpdate = pgActionToDrizzle(pgFk.confupdtype);
      const expOnDelete = (snapFk.onDelete || "no action").toLowerCase();
      const expOnUpdate = (snapFk.onUpdate || "no action").toLowerCase();

      if (actualOnDelete !== expOnDelete) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "FOREIGN_KEY_ACTION", object: key, property: "onDelete", expected: expOnDelete, actual: actualOnDelete });
      }
      if (actualOnUpdate !== expOnUpdate) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "FOREIGN_KEY_ACTION", object: key, property: "onUpdate", expected: expOnUpdate, actual: actualOnUpdate });
      }
    }
  }

  for (const [key, pgFk] of pgFkMap.entries()) {
    if (!snapFkMap.has(key)) {
      foreignKeysCompared++;
      if (manualFkSet.has(key)) {
        manualSqlObjects.push({ type: "DEFERRABLE_FK", name: pgFk.constraint_name, key });
      } else {
        trueDriftCount++;
        trueDriftDetails.push({ category: "FOREIGN_KEY", object: key, error: `Unexpected FK in PostgreSQL: ${pgFk.constraint_name}` });
      }
    }
  }

  // ── E. UNIQUE CONSTRAINTS ───────────────────────────────────────
  const pgUqs = await sql`
    SELECT
      con.conname AS constraint_name,
      cl.relname AS table_name,
      ARRAY_AGG(att.attname ORDER BY u.pos) AS columns
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_namespace n ON con.connamespace = n.oid
    JOIN LATERAL UNNEST(con.conkey) WITH ORDINALITY AS u(attnum, pos) ON TRUE
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
    WHERE n.nspname = 'public' AND con.contype = 'u'
    GROUP BY con.conname, cl.relname
    ORDER BY cl.relname, con.conname
  `;
  const pgUqMap = new Map();
  for (const uq of pgUqs) {
    pgUqMap.set(`${uq.table_name}.${uq.constraint_name}`, uq.columns);
  }

  let uniqueConstraintsCompared = 0;
  for (const table of Object.values(snap.tables)) {
    for (const uq of Object.values(table.uniqueConstraints || {})) {
      uniqueConstraintsCompared++;
      const fullKey = `${table.name}.${uq.name}`;
      const actualCols = pgUqMap.get(fullKey);
      if (!actualCols) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "UNIQUE_CONSTRAINT", object: fullKey, error: "Missing unique constraint in PostgreSQL" });
      } else if (JSON.stringify(uq.columns) !== JSON.stringify(actualCols)) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "UNIQUE_CONSTRAINT", object: fullKey, expected: uq.columns, actual: actualCols });
      }
    }
  }

  // ── F. CHECK CONSTRAINTS ───────────────────────────────────────
  const pgChecks = await sql`
    SELECT
      con.conname AS constraint_name,
      cl.relname AS table_name,
      pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class cl ON con.conrelid = cl.oid
    JOIN pg_namespace n ON con.connamespace = n.oid
    WHERE n.nspname = 'public' AND con.contype = 'c'
    ORDER BY cl.relname, con.conname
  `;
  const pgCheckMap = new Map();
  for (const chk of pgChecks) {
    pgCheckMap.set(`${chk.table_name}.${chk.constraint_name}`, chk.definition);
  }

  let checkConstraintsCompared = 0;
  for (const table of Object.values(snap.tables)) {
    for (const chk of Object.values(table.checkConstraints || {})) {
      checkConstraintsCompared++;
      const fullKey = `${table.name}.${chk.name}`;
      const actualDef = pgCheckMap.get(fullKey);
      if (!actualDef) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "CHECK_CONSTRAINT", object: fullKey, error: "Missing check constraint in PostgreSQL" });
      } else {
        normalizationDiffCount++;
      }
    }
  }

  // ── G. INDEXES ─────────────────────────────────────────────────
  const pgIndexes = await sql`
    SELECT
      c.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      pg_get_indexdef(ix.indexrelid) AS index_def
    FROM pg_index ix
    JOIN pg_class c ON ix.indrelid = c.oid
    JOIN pg_class i ON ix.indexrelid = i.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.contype IN ('p', 'u')
    WHERE n.nspname = 'public'
      AND con.oid IS NULL
    ORDER BY c.relname, i.relname
  `;
  const pgIndexMap = new Map();
  for (const idx of pgIndexes) {
    pgIndexMap.set(`${idx.table_name}.${idx.index_name}`, idx);
  }

  let indexesCompared = 0;
  for (const table of Object.values(snap.tables)) {
    for (const idx of Object.values(table.indexes || {})) {
      indexesCompared++;
      const fullKey = `${table.name}.${idx.name}`;
      const actualIdx = pgIndexMap.get(fullKey);
      if (!actualIdx) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "INDEX", object: fullKey, error: "Missing index in PostgreSQL" });
      } else if (idx.isUnique !== actualIdx.is_unique) {
        trueDriftCount++;
        trueDriftDetails.push({ category: "INDEX_UNIQUENESS", object: fullKey, expectedUnique: idx.isUnique, actualUnique: actualIdx.is_unique });
      }
    }
  }

  // ── H. ENUMS ───────────────────────────────────────────────────
  const pgEnums = await sql`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `;
  const pgEnumMap = new Map();
  for (const r of pgEnums) {
    if (!pgEnumMap.has(r.typname)) pgEnumMap.set(r.typname, []);
    pgEnumMap.get(r.typname).push(r.enumlabel);
  }

  let enumsCompared = 0;
  for (const snapEnum of Object.values(snap.enums || {})) {
    enumsCompared++;
    const actualValues = pgEnumMap.get(snapEnum.name);
    if (!actualValues) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "ENUM", object: snapEnum.name, error: "Missing enum type in PostgreSQL" });
    } else if (JSON.stringify(actualValues) !== JSON.stringify(snapEnum.values)) {
      trueDriftCount++;
      trueDriftDetails.push({ category: "ENUM_VALUES", object: snapEnum.name, expected: snapEnum.values, actual: actualValues });
    }
  }

  // ── I. CUSTOM MANUAL SQL OBJECTS VERIFICATION ─────────────────
  const pmuFns = await sql`
    SELECT proname 
    FROM pg_proc p 
    JOIN pg_namespace n ON p.pronamespace=n.oid 
    WHERE n.nspname='public' AND proname LIKE 'pmu_%' 
    ORDER BY proname
  `;
  assert.equal(pmuFns.length, 27, "Expected exactly 27 pmu_* functions present");

  const expectedImmutableTriggers = [
    "client_merge_history_immutable",
    "commercial_terms_immutable",
    "consent_template_version_guard",
    "consultation_immutable",
    "consultation_result_immutable",
    "conversation_messages_immutable",
    "cycle_consent_guard",
    "cycle_consent_zone_guard",
    "cycle_history_immutable",
    "cycle_review_immutable",
    "cycle_studio_lock",
    "follow_up_closure_immutable",
    "follow_up_revision_immutable",
    "ledger_entries_immutable",
    "master_price_history_immutable",
    "offer_identity_immutable",
    "offer_item_immutable",
    "offer_items_creation_only",
    "offer_revision_immutable",
    "qualification_immutable"
  ];
  const actualTrigNames = new Set((await sql`
    SELECT tgname 
    FROM pg_trigger t 
    JOIN pg_class c ON t.tgrelid=c.oid 
    JOIN pg_namespace n ON c.relnamespace=n.oid 
    WHERE n.nspname='public' AND NOT t.tgisinternal 
    ORDER BY tgname
  `).map(r => r.tgname));

  for (const tg of expectedImmutableTriggers) {
    assert.ok(actualTrigNames.has(tg), `Expected immutable trigger ${tg} to be present`);
  }

  // Output test report summary
  console.log("=== SCHEMA DRIFT VERIFICATION SUMMARY ===");
  console.log(`Expected tables: ${expectedTableNames.size}`);
  console.log(`Actual tables: ${actualTableNames.size}`);
  console.log(`Columns compared: ${columnsCompared}`);
  console.log(`Primary keys compared: ${primaryKeysCompared}`);
  console.log(`Foreign keys compared: ${foreignKeysCompared}`);
  console.log(`Unique constraints/indexes compared: ${uniqueConstraintsCompared}`);
  console.log(`Check constraints compared: ${checkConstraintsCompared}`);
  console.log(`Indexes compared: ${indexesCompared}`);
  console.log(`Enums compared: ${enumsCompared}`);
  console.log(`True drift count: ${trueDriftCount}`);
  console.log(`Normalization-only differences: ${normalizationDiffCount}`);
  console.log("=========================================");

  if (trueDriftCount > 0) {
    console.error("True drift detected:", JSON.stringify(trueDriftDetails, null, 2));
  }

  assert.equal(trueDriftCount, 0, `Schema drift detected: ${JSON.stringify(trueDriftDetails)}`);
});

// ─── 21. GOOGLE CALENDAR CROSS-STUDIO INTEGRITY (0034) ─────────────
test("google calendar cross-studio tenant integrity (0034)", async (t) => {
  const sql = await createTestDb(t, "gcal_tenant");
  await migrate(drizzle(sql), { migrationsFolder });

  const [studioA] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio A','studio-a') RETURNING id`;
  const [studioB] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio B','studio-b') RETURNING id`;

  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-a','User A','a@example.com',false,now(),now()), ('u-b','User B','b@example.com',false,now(),now())`;

  const [masterA] = await sql`INSERT INTO masters (studio_id,display_name,user_id) VALUES (${studioA.id},'Master A','u-a') RETURNING id`;
  const [masterB] = await sql`INSERT INTO masters (studio_id,display_name,user_id) VALUES (${studioB.id},'Master B','u-b') RETURNING id`;

  const [svcA] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studioA.id},'Service A','brows','brows',10000,60,10) RETURNING id`;
  const [svcB] = await sql`INSERT INTO services (studio_id,name,category,procedure_type,price_cents,duration_minutes,buffer_before_minutes) VALUES (${studioB.id},'Service B','brows','brows',10000,60,10) RETURNING id`;

  const [clientA] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status) VALUES (${studioA.id},'Client A','Client A','+39 333 1111111','new_lead') RETURNING id`;
  const [clientB] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status) VALUES (${studioB.id},'Client B','Client B','+39 333 2222222','new_lead') RETURNING id`;

  const [apptA] = await sql`INSERT INTO appointments (studio_id,client_id,master_id,service_id,start_at,end_at,source,created_by_id,service_snapshot,client_snapshot,master_snapshot,price_snapshot_cents,duration_snapshot_minutes) VALUES (${studioA.id},${clientA.id},${masterA.id},${svcA.id},'2026-11-01 10:00','2026-11-01 11:00','other','u-a','{}','{}','{}',10000,60) RETURNING id`;
  const [apptB] = await sql`INSERT INTO appointments (studio_id,client_id,master_id,service_id,start_at,end_at,source,created_by_id,service_snapshot,client_snapshot,master_snapshot,price_snapshot_cents,duration_snapshot_minutes) VALUES (${studioB.id},${clientB.id},${masterB.id},${svcB.id},'2026-11-01 10:00','2026-11-01 11:00','other','u-b','{}','{}','{}',10000,60) RETURNING id`;

  // Connection A in Studio A
  const [connA] = await sql`INSERT INTO google_calendar_connections (studio_id,user_id,master_id,calendar_id,status) VALUES (${studioA.id},'u-a',${masterA.id},'primary','connected') RETURNING id`;
  // Connection B in Studio B
  const [connB] = await sql`INSERT INTO google_calendar_connections (studio_id,user_id,master_id,calendar_id,status) VALUES (${studioB.id},'u-b',${masterB.id},'primary','connected') RETURNING id`;

  // 1. Same-studio mapping succeeds
  const [mappingA] = await sql`INSERT INTO google_calendar_event_mappings (studio_id,connection_id,appointment_id,google_event_id,last_synced_hash,status)
    VALUES (${studioA.id},${connA.id},${apptA.id},'g-event-a','hash-a','synced') RETURNING id`;
  assert.ok(mappingA.id, "Same-studio mapping must succeed");

  // 2. Cross-studio appointment mapping fails (mapping.studioId = Studio A, appointment owned by Studio B)
  await assert.rejects(
    sql`INSERT INTO google_calendar_event_mappings (studio_id,connection_id,appointment_id,google_event_id,last_synced_hash,status)
      VALUES (${studioA.id},${connA.id},${apptB.id},'g-event-x1','hash-x1','synced')`,
    /foreign key constraint|violates foreign key/i,
    "Cross-studio appointment mapping must fail at database level"
  );

  // 3. Cross-studio connection mapping fails (mapping.studioId = Studio A, connection owned by Studio B)
  await assert.rejects(
    sql`INSERT INTO google_calendar_event_mappings (studio_id,connection_id,appointment_id,google_event_id,last_synced_hash,status)
      VALUES (${studioA.id},${connB.id},${apptA.id},'g-event-x2','hash-x2','synced')`,
    /foreign key constraint|violates foreign key/i,
    "Cross-studio connection mapping must fail at database level"
  );

  // 4. Cross-studio master connection fails (connection.studioId = Studio A, master owned by Studio B)
  await assert.rejects(
    sql`INSERT INTO google_calendar_connections (studio_id,user_id,master_id,calendar_id,status)
      VALUES (${studioA.id},'u-a',${masterB.id},'secondary','connected')`,
    /foreign key constraint|violates foreign key/i,
    "Cross-studio master connection must fail at database level"
  );
});

// ─── 22. AI RUNS INTEGRITY & IDEMPOTENCY (0035) ─────────────────────
test("ai_runs cross-studio tenant integrity & request_key uniqueness (0035)", async (t) => {
  const sql = await createTestDb(t, "ai_runs_pg");
  await migrate(drizzle(sql), { migrationsFolder });

  const [studioA] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio A','studio-a') RETURNING id`;
  const [studioB] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio B','studio-b') RETURNING id`;

  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-ai-a','User A','ai-a@example.com',false,now(),now()), ('u-ai-b','User B','ai-b@example.com',false,now(),now())`;

  const [clientA] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status) VALUES (${studioA.id},'Client A','Client A','+39 333 1111111','new_lead') RETURNING id`;

  // 1. Valid AI run insert
  const [runA] = await sql`INSERT INTO ai_runs (
    studio_id, user_id, feature, entity_type, entity_id, status, provider, model, prompt_version, request_key, result
  ) VALUES (
    ${studioA.id}, 'u-ai-a', 'client_summary', 'client', ${clientA.id}, 'completed', 'fake', 'fake-model', 'client_summary.v1', 'req-ai-1', '{"summary":"test summary"}'
  ) RETURNING id`;
  assert.ok(runA.id, "Valid AI run must insert successfully");

  // 2. Duplicate request_key in same studio fails unique index
  await assert.rejects(
    sql`INSERT INTO ai_runs (
      studio_id, user_id, feature, entity_type, entity_id, status, provider, model, prompt_version, request_key
    ) VALUES (
      ${studioA.id}, 'u-ai-a', 'client_summary', 'client', ${clientA.id}, 'started', 'fake', 'fake-model', 'client_summary.v1', 'req-ai-1'
    )`,
    /unique constraint|duplicate key/i,
    "Duplicate request_key within same studio must be rejected"
  );

  // 3. Same request_key in different studio succeeds (tenant-scoped idempotency)
  const [runB] = await sql`INSERT INTO ai_runs (
    studio_id, user_id, feature, entity_type, entity_id, status, provider, model, prompt_version, request_key
  ) VALUES (
    ${studioB.id}, 'u-ai-b', 'client_summary', 'client', 'other-client', 'completed', 'fake', 'fake-model', 'client_summary.v1', 'req-ai-1'
  ) RETURNING id`;
  assert.ok(runB.id, "Same request_key in different studio must succeed");

  // 4. Invalid status check constraint
  await assert.rejects(
    sql`INSERT INTO ai_runs (
      studio_id, user_id, feature, entity_type, entity_id, status, provider, model, prompt_version
    ) VALUES (
      ${studioA.id}, 'u-ai-a', 'client_summary', 'client', ${clientA.id}, 'invalid_status', 'fake', 'fake-model', 'client_summary.v1'
    )`,
    /check constraint|ai_runs_status_check/i,
    "Invalid status must violate check constraint"
  );
});

// ─── 23. HANDOFFS INTEGRITY, CONCURRENCY & CONSTRAINTS (0036) ───────
test("handoffs cross-studio tenant integrity, request_key uniqueness & active pending unique constraint (0036)", async (t) => {
  const sql = await createTestDb(t, "handoffs_pg");
  await migrate(drizzle(sql), { migrationsFolder });

  const [studioA] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio A','studio-a') RETURNING id`;
  const [studioB] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio B','studio-b') RETURNING id`;

  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-hf-a1','User A1','hfa1@example.com',false,now(),now()), ('u-hf-a2','User A2','hfa2@example.com',false,now(),now()), ('u-hf-b','User B','hfb@example.com',false,now(),now())`;

  const [clientA] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status) VALUES (${studioA.id},'Client A','Client A','+39 333 1111111','new_lead') RETURNING id`;
  const [clientB] = await sql`INSERT INTO clients (studio_id,first_name,full_name,phone,client_status) VALUES (${studioB.id},'Client B','Client B','+39 333 2222222','new_lead') RETURNING id`;

  // 1. Valid handoff insert
  const [hf1] = await sql`INSERT INTO handoffs (
    studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, request_key, created_by_id
  ) VALUES (
    ${studioA.id}, 'CLIENT', ${clientA.id}, ${clientA.id}, 'u-hf-a2', 'HUMAN', 'MANUAL_HANDOFF', 'PENDING', 'HIGH', 'req-hf-1', 'u-hf-a1'
  ) RETURNING id`;
  assert.ok(hf1.id, "Valid handoff must insert successfully");

  // 2. Duplicate request_key within same studio fails
  await assert.rejects(
    sql`INSERT INTO handoffs (
      studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, request_key, created_by_id
    ) VALUES (
      ${studioA.id}, 'CLIENT', ${clientA.id}, ${clientA.id}, 'u-hf-a2', 'HUMAN', 'MANUAL_HANDOFF', 'PENDING', 'HIGH', 'req-hf-1', 'u-hf-a1'
    )`,
    /unique constraint|duplicate key/i,
    "Duplicate request_key within same studio must be rejected"
  );

  // 3. Second PENDING handoff for same entity in same studio fails partial unique index
  await assert.rejects(
    sql`INSERT INTO handoffs (
      studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, request_key, created_by_id
    ) VALUES (
      ${studioA.id}, 'CLIENT', ${clientA.id}, ${clientA.id}, 'u-hf-a2', 'HUMAN', 'MANUAL_HANDOFF', 'PENDING', 'HIGH', 'req-hf-2', 'u-hf-a1'
    )`,
    /unique constraint|handoffs_active_entity_unique/i,
    "Concurrent active PENDING handoff for same entity must be rejected by unique index"
  );

  // 4. Same request_key in different studio succeeds
  const [hf2] = await sql`INSERT INTO handoffs (
    studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, request_key, created_by_id
  ) VALUES (
    ${studioB.id}, 'CLIENT', ${clientB.id}, ${clientB.id}, 'u-hf-b', 'HUMAN', 'MANUAL_HANDOFF', 'PENDING', 'HIGH', 'req-hf-1', 'u-hf-b'
  ) RETURNING id`;
  assert.ok(hf2.id, "Same request_key in different studio must succeed");

  // 5. Cross-studio entity FK failure
  await assert.rejects(
    sql`INSERT INTO handoffs (
      studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, created_by_id
    ) VALUES (
      ${studioA.id}, 'CLIENT', ${clientB.id}, ${clientB.id}, 'u-hf-a2', 'HUMAN', 'MANUAL_HANDOFF', 'PENDING', 'HIGH', 'u-hf-a1'
    )`,
    /foreign key constraint|violates foreign key/i,
    "Cross-studio client FK must fail"
  );

  // 6. Check constraint violations
  await assert.rejects(
    sql`INSERT INTO handoffs (
      studio_id, entity_type, entity_id, client_id, to_user_id, source_type, reason_code, status, priority, created_by_id
    ) VALUES (
      ${studioA.id}, 'CLIENT', ${clientA.id}, ${clientA.id}, 'u-hf-a2', 'HUMAN', 'MANUAL_HANDOFF', 'INVALID_STATUS', 'HIGH', 'u-hf-a1'
    )`,
    /check constraint|handoffs_status_check/i,
    "Invalid status must violate check constraint"
  );
});

// ─── 24. WORKER HEARTBEATS & OPERATIONS INTEGRITY (0037) ──────────
test("worker heartbeats upsert, uniqueness & operations permissions (0037)", async (t) => {
  const sql = await createTestDb(t, "heartbeats_pg");
  await migrate(drizzle(sql), { migrationsFolder });

  // 1. Valid worker heartbeat insert
  const [hb1] = await sql`INSERT INTO worker_heartbeats (
    worker_name, instance_id, last_heartbeat, started_at, version, metadata
  ) VALUES (
    'outbox-worker', 'inst-1', now(), now(), '1.0.0', '{"hostname":"node-1"}'
  ) RETURNING id`;
  assert.ok(hb1.id, "Valid worker heartbeat must insert successfully");

  // 2. Duplicate (worker_name, instance_id) violates unique index
  await assert.rejects(
    sql`INSERT INTO worker_heartbeats (
      worker_name, instance_id, last_heartbeat, started_at, version
    ) VALUES (
      'outbox-worker', 'inst-1', now(), now(), '1.0.0'
    )`,
    /unique constraint|duplicate key/i,
    "Duplicate (worker_name, instance_id) must violate unique constraint"
  );

  // 3. Upsert on conflict succeeds and updates last_heartbeat
  const [hbUpsert] = await sql`INSERT INTO worker_heartbeats (
    worker_name, instance_id, last_heartbeat, started_at, version, metadata
  ) VALUES (
    'outbox-worker', 'inst-1', now(), now(), '1.0.1', '{"status":"active"}'
  ) ON CONFLICT (worker_name, instance_id) DO UPDATE SET
    last_heartbeat = EXCLUDED.last_heartbeat,
    version = EXCLUDED.version,
    metadata = EXCLUDED.metadata
  RETURNING id, version`;
  assert.equal(hbUpsert.id, hb1.id, "Upsert must update existing row");
  assert.equal(hbUpsert.version, "1.0.1", "Upsert must update fields");

  // 4. Multiple distinct instances coexist safely
  const [hb2] = await sql`INSERT INTO worker_heartbeats (
    worker_name, instance_id, last_heartbeat, started_at, version
  ) VALUES (
    'outbox-worker', 'inst-2', now(), now(), '1.0.0'
  ) RETURNING id`;
  assert.ok(hb2.id, "Distinct worker instance must insert successfully");
  assert.notEqual(hb2.id, hb1.id);

  // 5. Operations permissions seeded correctly
  const perms = (await sql`SELECT code FROM permissions WHERE code IN ('OPERATIONS_READ', 'OPERATIONS_MANAGE')`).map(r => r.code);
  assert.ok(perms.includes("OPERATIONS_READ"), "OPERATIONS_READ permission must exist");
  assert.ok(perms.includes("OPERATIONS_MANAGE"), "OPERATIONS_MANAGE permission must exist");

  // 6. Access logs operation check constraint accepts operations actions
  const [studio] = await sql`INSERT INTO studios (name,slug) VALUES ('Studio Ops','studio-ops') RETURNING id`;
  await sql`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('u-ops','User Ops','ops@example.com',false,now(),now())`;
  const [acc] = await sql`INSERT INTO access_logs (
    studio_id, actor_id, operation, target_id, result, record_ids, record_count
  ) VALUES (
    ${studio.id}, 'u-ops', 'operations.metrics', 'sys', 'returned', '[]', 0
  ) RETURNING id`;
  assert.ok(acc.id, "access_logs must accept operations.metrics");
});

test("25. Phase 17 — Privacy requests, retention policies, permissions and access operations", async (t) => {
  const sql = await createTestDb(t, "phase17_privacy");
  const folder = await buildPartialMigrationFolder(t, 39);
  await migrate(drizzle(sql), { migrationsFolder: folder });

  // 1. Seed studio and user
  const [studio] = await sql`INSERT INTO studios (name, slug) VALUES ('Studio Privacy', 'studio-privacy') RETURNING id`;
  const [user1] = await sql`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u-privacy-1', 'Privacy Admin', 'privacy@example.com', false, now(), now()) RETURNING id`;
  const [client1] = await sql`INSERT INTO clients (studio_id, first_name, last_name, full_name, phone, client_status) VALUES (${studio.id}, 'Jane', 'Doe', 'Jane Doe', '+1234567890', 'new_lead') RETURNING id`;

  // 2. Insert valid privacy request
  const [req1] = await sql`INSERT INTO privacy_requests (
    studio_id, client_id, request_type, status, requested_by_id, command_id
  ) VALUES (
    ${studio.id}, ${client1.id}, 'EXPORT', 'REQUESTED', ${user1.id}, 'cmd-priv-1'
  ) RETURNING id, status, request_type`;
  assert.ok(req1.id);
  assert.equal(req1.status, 'REQUESTED');
  assert.equal(req1.request_type, 'EXPORT');

  // 3. Reject invalid request_type
  await assert.rejects(
    sql`INSERT INTO privacy_requests (
      studio_id, client_id, request_type, status, requested_by_id
    ) VALUES (
      ${studio.id}, ${client1.id}, 'INVALID_TYPE', 'REQUESTED', ${user1.id}
    )`,
    /check constraint|violates check/i,
    "Invalid request_type must violate check constraint"
  );

  // 4. Reject invalid status
  await assert.rejects(
    sql`INSERT INTO privacy_requests (
      studio_id, client_id, request_type, status, requested_by_id
    ) VALUES (
      ${studio.id}, ${client1.id}, 'EXPORT', 'INVALID_STATUS', ${user1.id}
    )`,
    /check constraint|violates check/i,
    "Invalid status must violate check constraint"
  );

  // 5. Studio privacy retention policies unique per studio
  const [pol1] = await sql`INSERT INTO studio_privacy_retention_policies (
    studio_id, temporary_upload_retention_days, privacy_export_retention_days, orphan_media_grace_days
  ) VALUES (
    ${studio.id}, 7, 30, 14
  ) RETURNING id`;
  assert.ok(pol1.id);

  await assert.rejects(
    sql`INSERT INTO studio_privacy_retention_policies (
      studio_id, temporary_upload_retention_days, privacy_export_retention_days, orphan_media_grace_days
    ) VALUES (
      ${studio.id}, 10, 60, 20
    )`,
    /unique constraint|duplicate key/i,
    "Duplicate retention policy for studio must violate unique constraint"
  );

  // 6. Privacy permissions seeded correctly
  const perms = (await sql`SELECT code FROM permissions WHERE code IN ('PRIVACY_READ', 'PRIVACY_EXPORT', 'PRIVACY_MANAGE')`).map(r => r.code);
  assert.ok(perms.includes("PRIVACY_READ"), "PRIVACY_READ permission must exist");
  assert.ok(perms.includes("PRIVACY_EXPORT"), "PRIVACY_EXPORT permission must exist");
  assert.ok(perms.includes("PRIVACY_MANAGE"), "PRIVACY_MANAGE permission must exist");

  // 7. Access logs accept privacy operations
  const [accLog] = await sql`INSERT INTO access_logs (
    studio_id, actor_id, operation, target_id, result, record_ids, record_count
  ) VALUES (
    ${studio.id}, ${user1.id}, 'privacy.requests.list', 'sys', 'returned', '[]', 0
  ) RETURNING id`;
  assert.ok(accLog.id, "access_logs must accept privacy.requests.list");

  // 8. Audit logs accept privacy actions
  const [auditLog] = await sql`INSERT INTO audit_logs (
    studio_id, user_id, action, contract_version, old_values, new_values, reason, reason_source, entity_type, entity_id
  ) VALUES (
    ${studio.id}, ${user1.id}, 'privacy_request_created', 1, '{}', '{"status":"REQUESTED"}', 'DSAR request initiated', 'user', 'privacy_request', ${req1.id}
  ) RETURNING id`;
  assert.ok(auditLog.id, "audit_logs must accept privacy_request_created");
});
