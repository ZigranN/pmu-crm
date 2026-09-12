import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
// Verified against the read-only Neon migration journal on 2026-09-12.
// Preserve applied history; append future migrations instead of editing these.
const deployedHashes = [
  "2a69d9c73b08542f9314754839615f4f97d31c09a94688981bbcea8b5e238501",
  "561a13c58337d1e58fa50c65cd1d36af507213cf084e1e866dff14c1a4797f72",
  "375530a134520709f555bcc994706cb44cbffbfdc4d0480f18c137ef9f64ae8d",
  "0565454bb96666200a5161ae920cbb5f8cac1b46be028aba7983d4106f6713d3",
];
const clientFields = [
  "referred_by_name", "interest", "treatment_zone",
  "next_contact_at", "campaign_tag", "service_tag",
];

test("migration history is readable and preserves deployed SQL hashes", () => {
  const migrations = readMigrationFiles({ migrationsFolder });
  assert.ok(migrations.length >= deployedHashes.length);
  assert.deepEqual(migrations.slice(0, deployedHashes.length).map((m) => m.hash), deployedHashes);
});

test("every journal entry has a linked snapshot and increasing timestamp", async () => {
  const journal = await readJson(path.join(migrationsFolder, "meta/_journal.json"));
  let previous;
  let previousTime = 0;
  for (const [index, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, index);
    assert.ok(entry.when > previousTime);
    const snapshot = await readJson(path.join(
      migrationsFolder, "meta", `${String(index).padStart(4, "0")}_snapshot.json`,
    ));
    assert.equal(snapshot.dialect, "postgresql");
    if (previous) assert.equal(snapshot.prevId, previous.id);
    previous = snapshot;
    previousTime = entry.when;
  }
});

test("recovered snapshot changes only the six missing client columns", async () => {
  const before = await readJson(path.join(migrationsFolder, "meta/0001_snapshot.json"));
  const after = await readJson(path.join(migrationsFolder, "meta/0002_snapshot.json"));
  const columns = after.tables["public.clients"].columns;
  for (const field of clientFields) {
    assert.equal(columns[field].notNull, false);
    assert.equal(columns[field].type, field === "next_contact_at" ? "timestamp" : "text");
    delete columns[field];
  }
  after.id = before.id;
  after.prevId = before.prevId;
  assert.deepEqual(after, before);
});

// Isolated PostgreSQL WASM engines: no application URL, sockets or shared DB.
test("fresh install, upgrade with data, and repeated migrate converge", async (t) => {
  function createDatabase() {
    const engine = new PGlite();
    t.after(() => engine.close());
    const query = async (parts, ...values) => {
      const text = parts.reduce((result, part, index) =>
        result + (index ? `$${index}` : "") + part, "");
      return (await engine.query(text, values)).rows;
    };
    return { engine, query };
  }
  async function catalog(sql) {
    return {
      columns: Array.from(await sql`
        select table_name, column_name, udt_name, is_nullable, column_default
        from information_schema.columns where table_schema = 'public'
        order by table_name, ordinal_position`),
      enums: Array.from(await sql`
        select t.typname, e.enumlabel, e.enumsortorder
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on t.typnamespace = n.oid
        where n.nspname = 'public' order by t.typname, e.enumsortorder`),
      constraints: Array.from(await sql`
        select c.relname as table_name, co.conname, co.contype,
          pg_get_constraintdef(co.oid) as definition
        from pg_constraint co join pg_class c on co.conrelid = c.oid
        join pg_namespace n on c.relnamespace = n.oid
        where n.nspname = 'public' order by 1, 2`),
      indexes: Array.from(await sql`
        select tablename, indexname, indexdef from pg_indexes
        where schemaname = 'public' order by 1, 2`),
    };
  }
  const freshDatabase = createDatabase();
  const fresh = freshDatabase.query;
  await migrate(drizzle(freshDatabase.engine), { migrationsFolder });
  const upgradedDatabase = createDatabase();
  const upgraded = upgradedDatabase.query;
  const legacyFolder = await mkdtemp(path.join(tmpdir(), "pmu-legacy-migrations-"));
  t.after(() => rm(legacyFolder, { recursive: true, force: true }));
  await mkdir(path.join(legacyFolder, "meta"));
  const journal = await readJson(path.join(migrationsFolder, "meta/_journal.json"));
  const legacy = { ...journal, entries: journal.entries.slice(0, 2) };
  await writeFile(path.join(legacyFolder, "meta/_journal.json"), JSON.stringify(legacy));
  for (const entry of legacy.entries) {
    await copyFile(path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(legacyFolder, `${entry.tag}.sql`));
  }
  await migrate(drizzle(upgradedDatabase.engine), { migrationsFolder: legacyFolder });
  const [studio] = await upgraded`
    insert into studios (name, slug) values ('Migration test', 'migration-test') returning id`;
  const [client] = await upgraded`
    insert into clients (studio_id, first_name, full_name, phone, client_status, notes)
    values (${studio.id}, 'Fixture', 'Fixture Client', '+390000000000', 'new_lead', 'Preserve me')
    returning *`;
  const [role] = await upgraded`insert into roles (code, name) values ('TEST', 'Test') returning id`;
  const [permission] = await upgraded`insert into permissions (code, name) values ('TEST', 'Test') returning id`;
  const [originalGrant] = await upgraded`insert into role_permissions (role_id, permission_id, created_at)
    values (${role.id}, ${permission.id}, '2026-01-01') returning id`;
  await upgraded`insert into role_permissions (role_id, permission_id, created_at)
    values (${role.id}, ${permission.id}, '2026-01-02')`;
  await migrate(drizzle(upgradedDatabase.engine), { migrationsFolder });
  assert.deepEqual(await upgraded`select id from role_permissions`, [originalGrant]);
  await assert.rejects(upgraded`insert into role_permissions (role_id, permission_id) values (${role.id}, ${permission.id})`);
  const [preserved] = await upgraded`select * from clients where id = ${client.id}`;
  for (const [key, value] of Object.entries(client)) assert.deepEqual(preserved[key], value);
  for (const field of clientFields) assert.equal(preserved[field], null);
  await upgraded`update clients set referred_by_name = 'Fixture source', interest = 'PMU',
    treatment_zone = 'brows', next_contact_at = '2026-09-15 09:30:00',
    campaign_tag = 'test-campaign', service_tag = 'test-service' where id = ${client.id}`;
  const beforeRepeat = await upgraded`select * from clients where id = ${client.id}`;
  const history = await upgraded`select * from drizzle.__drizzle_migrations order by created_at`;
  await migrate(drizzle(upgradedDatabase.engine), { migrationsFolder });
  assert.deepEqual(await upgraded`select * from clients where id = ${client.id}`, beforeRepeat);
  assert.deepEqual(await upgraded`select * from drizzle.__drizzle_migrations order by created_at`, history);
  assert.deepEqual(await catalog(upgraded), await catalog(fresh));
  assert.equal(history.length, journal.entries.length);
  assert.deepEqual(history.map((row) => row.hash),
    readMigrationFiles({ migrationsFolder }).map((migration) => migration.hash));
});
