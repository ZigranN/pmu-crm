# Phase 0.2 — Migration Chain Verification

## 1. Baseline Identity

- **Branch**: `main`
- **Commit**: `c260452ca4d614fae926a973c2717476cacd7df8`
- **Migration head**: `0020_cycle_commercial_terms`
- **PostgreSQL**: 17.11 (Docker `compose.test.yml`)
- **Node**: v22.22.2, npm 10.9.7

## 2. Journal / SQL / Snapshot Reconciliation

| idx | tag | sql | snapshot | journal | status |
| --- | --- | --- | -------- | ------- | ------ |
| 0 | 0000_windy_the_watchers | present | present | present | PASS |
| 1 | 0001_rainy_norman_osborn | present | present | present | PASS |
| 2 | 0002_spicy_captain_midlands | present | present | present | PASS |
| 3 | 0003_consent_archive_event | present | present | present | PASS |
| 4 | 0004_seed_identity | present | present | present | PASS |
| 5 | 0005_role_policy | present | present | present | PASS |
| 6 | 0006_master_assignment_scope | present | present | present | PASS |
| 7 | 0007_audit_access_contract | present | present | present | PASS |
| 8 | 0008_command_reliability | present | present | present | PASS |
| 9 | 0009_service_catalog | present | present | present | PASS |
| 10 | 0010_pricing_offers | present | present | present | PASS |
| 11 | 0011_client_administration | present | present | present | PASS |
| 12 | 0012_client_deduplication | present | present | present | PASS |
| 13 | 0013_client_merge | present | present | present | PASS |
| 14 | 0014_treatment_cycle_foundation | present | present | present | PASS |
| 15 | 0015_cycle_stage_commands | present | present | present | PASS |
| 16 | 0016_consultation_decisions | present | present | present | PASS |
| 17 | 0017_cycle_follow_up_tasks | present | present | present | PASS |
| 18 | 0018_follow_up_rescheduling | present | present | present | PASS |
| 19 | 0019_cycle_reassessment | present | present | present | PASS |
| 20 | 0020_cycle_commercial_terms | present | present | present | PASS |

- 21 SQL files, 21 journal entries, 21 snapshots
- No gaps, no orphan SQL, no orphan snapshots, no duplicate idx/tag
- Timestamps strictly increasing
- All snapshots: dialect=postgresql, version=7

## 3. Fresh Migration

- Empty disposable PostgreSQL 17 DB
- `migrate(drizzle(sql), { migrationsFolder })` — actual Drizzle migrator
- 21 migration rows in `drizzle.__drizzle_migrations`
- Hash sequence matches `readMigrationFiles()` output
- 22 `pmu_*` functions verified present
- 15 named triggers verified present
- 66 public tables created

## 4. Repeat Migration

- Second `migrate()` call on same DB
- Migration table unchanged (same rows, same hashes)
- No duplicate objects, no errors
- PASS

## 5. Upgrade 0008 → 0020

- Partial migration folder with entries 0–8, applied via Drizzle migrator (9 rows)
- Fixtures inserted at 0008 schema: Studio, User, Client, Master, Service, Appointment, Payment, PaymentTransaction
- Full migration folder applied (21 rows)
- Verified Studio & User: `id`, `name`, `slug`, `email` preserved
- Verified Client: `id`, `studio_id`, `first_name`, `full_name`, `phone`, `client_status`, `notes` preserved; `phone_key="+393331234567"`, `name_key="alice upa"`, null key defaults backfilled
- Verified Master: `id`, `studio_id`, `display_name` preserved
- Verified Service: `id`, `studio_id`, `name`, `category`, `procedure_type`, `price_cents=8000`, `duration_minutes=60`, `buffer_before_minutes=10`, `catalog_version=0`, `price_mode="legacy"` preserved
- Verified Appointment: `id`, `studio_id`, `client_id`, `master_id`, `service_id`, `start_at`, `end_at`, `source="other"`, `created_by_id`, `price_snapshot_cents=8000`, `duration_snapshot_minutes=60`, snapshot objects preserved
- Verified Payment & Transaction: `id`, `studio_id`, `client_id`, `appointment_id`, `total_amount_cents=8000`, `balance_amount_cents=8000`, `amount_cents=8000`, `method="cash"`, `type="full_payment"` preserved
- PASS

## 6. Upgrade 0013 → 0020

- Partial folder 0–13, applied via Drizzle migrator (14 rows)
- Fixtures: Studio, User, Client (Bob), duplicate Client (Dup), Master, 2 Services (SB, SB2), MasterPriceRevision, CustomOffer + Revision + 2 Items (transactional), ClientMerge
- Full migration applied (21 rows)
- Verified Clients: `id`, `studio_id`, names, phone keys (`+15559876543`, `+15551111111`) and name keys preserved
- Verified Master & Services: `id`, names, price cents (5000, 3000) preserved
- Verified Price Revision: `id`, `studio_id`, `master_id`, `service_id`, `price_cents=5000`, `revision=1`, `reason="initial"`, `approved_by_id` preserved
- Verified Custom Offer & Revision: `id`, `client_id`, `revision=1`, `agreed_total_cents=8000`, `standard_total_cents=8000`, `discount_cents=0`, `reason="test"`, `approved_by_id` preserved
- Verified Offer Items: exactly 2 items preserved with matching `service_id`, `service_name`, `zone_code`, and `standard_cents` (5000, 3000)
- Verified Client Merge: `id`, `studio_id`, `target_id`, `source_id`, `actor_id`, `reason="test merge reason"`, `review_token="tok"` preserved
- PASS

## 7. Upgrade 0019 → 0020

- Partial folder 0–19, applied via Drizzle migrator (20 rows)
- Fixtures: Studio, User, Client, Master, Service, TreatmentCycle(stage=thinking), CommandReceipt, CycleStageHistory
- Full migration applied (21 rows)
- Verified Studio, User, Client, Master, Service identity and attributes preserved
- Verified Treatment Cycle: `id`, `studio_id`, `client_id`, `zone_code="brows"`, `kind="pmu"`, `stage="thinking"` preserved
- Verified Command Receipt: `id`, `studio_id`, `actor_id`, `command="cycle.transition.v1"`, `request_key`, `payload_hash`, `result` JSON preserved
- Verified Cycle Stage History: `id`, `studio_id`, `cycle_id`, `from_stage="new_lead"`, `to_stage="thinking"`, `version=1`, `actor_id`, `command_id`, `reason` preserved
- Verified Cycle Commercial Terms: table exists, initially empty (0 rows), and successfully verified accepting new terms with receipt on upgraded DB
- PASS

## 8. Data Preservation

All upgrade scenarios verified:
- Scalar IDs preserved across all tables
- FK relationships intact after migration across multiple upgrade stages
- Nullable/default backfills as expected (phone_key, name_key computed by 0012; catalog_version/price_mode defaults in 0009)
- No records silently deleted or mutated during intermediate and final migrations
- Legacy appointment → client/master/service FKs valid
- Legacy payment & transaction → client/appointment FKs valid
- Offer → client, revision → offer, item → revision FKs valid
- Merge → target/source client FKs valid
- Cycle → client FK valid, stage history → cycle FK valid, command receipts valid
- 0020 cycle commercial terms fully functional on upgraded databases

## 9. Manual Functions / Triggers

### Functions (22 verified present after fresh migration)

| Function | Present |
| --- | --- |
| pmu_reject_pricing_history_change | YES |
| pmu_offer_item_creation_only | YES |
| pmu_check_offer_revision_total | YES |
| pmu_phone_key | YES |
| pmu_email_key | YES |
| pmu_instagram_key | YES |
| pmu_name_key | YES |
| pmu_guard_offer_identity | YES |
| pmu_lock_cycle_studio | YES |
| pmu_validate_cycle_links | YES |
| pmu_validate_procedure_cycle | YES |
| pmu_cycle_stage_evidence | YES |
| pmu_cycle_history_receipt | YES |
| pmu_cycle_history_immutable | YES |
| pmu_consultation_evidence_guard | YES |
| pmu_consultation_immutable | YES |
| pmu_consultation_task_guard | YES |
| pmu_follow_up_task_guard | YES |
| pmu_follow_up_revision_guard | YES |
| pmu_follow_up_closure_guard | YES |
| pmu_cycle_review_guard | YES |
| pmu_commercial_terms_guard | YES |

### Triggers (15 verified present)

| Trigger | Present |
| --- | --- |
| master_price_history_immutable | YES |
| offer_identity_immutable | YES |
| offer_revision_immutable | YES |
| offer_item_immutable | YES |
| offer_items_creation_only | YES |
| client_merge_history_immutable | YES |
| cycle_studio_lock | YES |
| cycle_history_immutable | YES |
| qualification_immutable | YES |
| consultation_result_immutable | YES |
| consultation_immutable | YES |
| follow_up_revision_immutable | YES |
| follow_up_closure_immutable | YES |
| cycle_review_immutable | YES |
| commercial_terms_immutable | YES |

## 10. Guard Behavior Tests

| Guard | Valid insert | Forbidden mutation rejected | Status |
| --- | --- | --- | --- |
| Pricing history immutable (0010) | price revision inserted | UPDATE rejected | PASS |
| Offer revision immutable (0010) | revision+items in tx | UPDATE rejected | PASS |
| Offer item immutable (0010) | item in same tx | UPDATE rejected | PASS |
| Merge history immutable (0013) | merge record inserted | UPDATE rejected | PASS |
| Cross-studio cycle (0014) | same-studio cycle OK | cross-studio INSERT rejected (FK) | PASS |
| Cycle history immutable (0015) | history with receipt | UPDATE rejected | PASS |
| Consultation immutable (0016) | consultation with completed visit | UPDATE rejected | PASS |
| Qualification immutable (0016) | qualification with receipt | UPDATE rejected | PASS |
| Follow-up revision immutable (0018) | revision with receipt in tx | UPDATE rejected | PASS |
| Cycle review immutable (0019) | review with receipt in tx | UPDATE rejected | PASS |
| Follow-up closure immutable (0019) | closure inserted | UPDATE rejected | PASS |
| Commercial terms immutable (0020) | terms with receipt in tx | UPDATE rejected | PASS |

### Dedup normalization (0012)

| Function | Input | Exact output |
| --- | --- | --- |
| pmu_phone_key | `+1 (234) 567-8900` | `+12345678900` |
| pmu_phone_key | `not a phone` | `null` |
| pmu_email_key | `  Alice@Example.COM  ` | `alice@example.com` |
| pmu_email_key | `nope` | `null` |
| pmu_instagram_key | `@Alice_PMU` | `alice_pmu` |
| pmu_name_key | `  Alice  Test  ` | `alice test` |

## 11. Schema Drift

**Method**: Deterministic catalog-to-snapshot structural comparison on a fresh disposable PostgreSQL 17 database migrated via `migrate(drizzle(sql), { migrationsFolder })` up to head `0020_cycle_commercial_terms`. The database schema was compared directly against `drizzle/meta/0020_snapshot.json` using PostgreSQL system catalogs (`information_schema` and `pg_catalog`).

**Comparison Results**:

| Category | Expected (0020 Snapshot) | Actual (PostgreSQL 17 Catalog) | True Drift | Normalization / Manual SQL | Status |
| --- | --- | --- | --- | --- | --- |
| **Tables** | 66 public tables | 66 public tables | 0 | 0 | PASS |
| **Columns** | 759 columns | 759 columns | 0 | 378 (types/defaults normalization) | PASS |
| **Primary Keys** | 66 tables | 66 primary keys | 0 | 0 | PASS |
| **Foreign Keys** | 175 snapshot FKs | 181 foreign keys | 0 | 6 (intentionally manual deferrable FKs) | PASS |
| **Unique Constraints** | 5 unique constraints | 5 unique constraints | 0 | 0 | PASS |
| **Check Constraints** | 43 check constraints | 43 check constraints | 0 | 43 (SQL formatting normalization) | PASS |
| **Indexes** | 97 standalone non-PK indexes | 97 standalone non-PK indexes | 0 | 0 | PASS |
| **Enums** | 33 enum types | 33 enum types | 0 | 0 (ordered values identical) | PASS |
| **Total True Drift** | — | — | **0** | — | **PASS** |

**Intentionally Manual SQL Objects (Excluded from Snapshot Drift)**:
- 6 Deferrable Foreign Keys: `qualification_receipt_fk`, `result_receipt_fk`, `task_consultation_studio_fk`, `follow_up_revision_receipt_fk`, `cycle_review_receipt_fk`, `commercial_terms_receipt_fk` (created via raw SQL migrations for transactional receipt enforcement).
- 22 `pmu_*` Functions: verified present in PostgreSQL catalog.
- 15 Named Immutable Triggers + 13 Constraint Triggers: verified present in PostgreSQL catalog.

## 12. Relations Validation

- `npm run typecheck` passes cleanly — `src/db/relations.ts` compiles against `src/db/schema.ts`
- TypeScript compilation validates that referenced tables, FK columns, and relation names are consistent
- No type errors in schema or relations files

## 13. Commands Run

```text
Command: git status --short --branch
Exit code: 0
Result: ## main...origin/main, no tracked changes

Command: git rev-parse HEAD
Exit code: 0
Result: c260452ca4d614fae926a973c2717476cacd7df8

Command: docker compose -f compose.test.yml up -d --wait
Exit code: 0
Result: PostgreSQL 17.11 running on port 5433

Command: node --test tests/phase02-pg-verify.mjs
Exit code: 0
Result: 18 tests, 18 pass, 0 fail (includes deterministic schema drift verification)

Command: npm run test:migrations
Exit code: 0
Result: 4 tests, 4 pass, 0 fail

Command: npm run typecheck
Exit code: 0
Result: Clean

Command: npm run lint
Exit code: 0
Result: Clean
```

## 14. Failures / Findings

No migration failures. No data loss. No unexpected drift.

**Finding**: Deterministic catalog inspection proves 100% structural fidelity between `0020_snapshot.json` and the migrated PostgreSQL 17 schema, with 0 true schema drift.

## 15. Known Limitations

- Production/Neon schema not verified (out of scope)
- Full CI suite not executed (migration tests only)
- Playwright not executed
- Real Cloudinary/provider credentials not tested
- Business logic correctness not tested (only DB integrity)
- `pmu_validate_procedure_cycle` and `pmu_consultation_task_guard` verified as present but not behaviorally exercised (complex multi-table prerequisites)

## 16. Acceptance Matrix

| Criterion | PASS / FAIL | Evidence |
| --- | --- | --- |
| Canonical branch/commit verified | PASS | Branch `main`, HEAD commit `c260452ca4d614fae926a973c2717476cacd7df8` |
| Migration head verified | PASS | `0020_cycle_commercial_terms` (entry idx 20) |
| Exact journal/SQL/snapshot set reconciled | PASS | Exactly 21 journal entries, 21 SQL files, 21 snapshots matched |
| No orphan SQL | PASS | Set comparison confirmed 0 orphan SQL files in `drizzle/` |
| No orphan snapshots | PASS | Set comparison confirmed 0 orphan snapshot JSON files in `drizzle/meta/` |
| No migration index gaps | PASS | Journal indices contiguous 0..20 with monotonically increasing timestamps |
| Snapshot lineage valid | PASS | All 21 snapshots have `dialect: postgresql`, `version: 7`, and unbroken UUID chaining |
| Canonical test DB safety reused | PASS | `tests/support/database-url.ts` canonical loopback/naming rules directly reused |
| Fresh 0000→0020 succeeds with Drizzle | PASS | `migrate(drizzle(sql), { migrationsFolder })` creates 66 tables, 21 migration rows |
| Repeat migration succeeds | PASS | Second `migrate()` execution is fully idempotent (0 new rows/errors) |
| Upgrade 0008→0020 succeeds | PASS | Partial migration folder (0..8) upgraded to 0..20 with all schema additions |
| Legacy appointment relationships preserved | PASS | Appointment FKs to Client, Master, Service, and financial snapshots preserved |
| Legacy payment relationships preserved | PASS | Payment and PaymentTransaction records and balance FKs preserved |
| Upgrade 0013→0020 succeeds | PASS | Partial migration folder (0..13) upgraded to 0..20 with data intact |
| Pricing history preserved | PASS | MasterPriceRevision rows and revision numbers preserved |
| Offer/revision/items preserved | PASS | CustomOffer, OfferRevision, and OfferItem transactional items preserved |
| Merge target/source/provenance preserved | PASS | ClientMerge target/source/provenance fields and review token preserved |
| Upgrade 0019→0020 succeeds | PASS | Partial migration folder (0..19) upgraded to 0..20 with data intact |
| Treatment Cycle preserved | PASS | TreatmentCycle stage, client_id, and zone_code preserved |
| Cycle history/command evidence preserved | PASS | CycleStageHistory, CommandReceipt payload hash, and result JSON preserved |
| Manual functions present | PASS | Exactly 22 `pmu_*` custom functions present in `pg_proc` |
| Required business triggers present | PASS | 15 named immutable triggers + 13 constraint triggers present in `pg_trigger` |
| Representative DB guards enforced | PASS | 12 negative guard behavioral tests pass (rejecting unauthorized mutations) |
| Cross-studio cycle rejected | PASS | Composite foreign key `(client_id, studio_id)` rejects cross-studio insertions |
| Deterministic schema drift comparison completed | PASS | Catalog comparison against `0020_snapshot.json` completed across all schema objects |
| TRUE_DRIFT count = 0 | PASS | 0 true drift across 66 tables, 759 columns, 66 PKs, 181 FKs, 5 UQs, 43 checks, 97 indexes, 33 enums |
| Relations/typecheck valid | PASS | `src/db/relations.ts` compiles cleanly against `src/db/schema.ts` |
| Migration verification tests pass | PASS | 18/18 tests pass in `phase02-pg-verify.mjs`, 4/4 in `migrations.test.mjs` |
| Typecheck passes | PASS | `npm run typecheck` exits 0 with 0 errors |
| Lint passes | PASS | `npm run lint` exits 0 with 0 errors |
| No production DB used | PASS | Enforced canonical localhost-only test DB URL on port 5433 |
| Historical migrations unchanged | PASS | `git diff --name-only drizzle/*.sql` is empty |
| Snapshots unchanged | PASS | `git diff --name-only drizzle/meta/*` is empty |
| Production/business source unchanged | PASS | `git diff --name-only src/` is empty |
| Dependencies unchanged | PASS | `package.json` and `package-lock.json` unmodified |

PHASE 0.2 READY FOR HUMAN ACCEPTANCE
