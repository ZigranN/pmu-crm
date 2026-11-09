# CANONICAL BASELINE — Phase 0.1

## 1. Snapshot Identity

| Field              | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| Date/time          | 2026-09-19T15:26:00+06:00                                    |
| Branch             | `main`                                                       |
| Commit SHA         | `c260452ca4d614fae926a973c2717476cacd7df8`                    |
| Last commit        | `c260452 Merge pull request #19 from ZigranN/codex/phase-3-offer-terms` |
| Working tree state | DIRTY — no staged or modified tracked files; 1 untracked file: `src.zip`. No merge/rebase/cherry-pick in progress. |
| Upstream relation  | Up-to-date with `origin/main`                                |
| Remote             | `https://github.com/ZigranN/pmu-crm.git`                     |

---

## 2. Runtime

| Component             | Version    |
| --------------------- | ---------- |
| Node                  | 22.22.2    |
| npm                   | 10.9.7     |
| Next.js               | 16.2.6     |
| React                 | 19.2.4     |
| React DOM             | 19.2.4     |
| TypeScript            | ^5         |
| Drizzle ORM           | 0.45.2     |
| Drizzle Kit           | 0.31.10    |
| PostgreSQL test image | 17         |
| Better Auth           | 1.6.11     |
| Zod                   | 4.4.3      |
| Vitest                | 4.1.11     |
| Playwright            | 1.63.0     |
| ESLint                | 9.39.4     |
| PGlite (test)         | 0.5.8      |
| postgres (driver)     | 3.4.9      |
| Cloudinary SDK        | 2.10.0     |

---

## 3. Repository Structure

### Directories

| Path         | Purpose                                                  |
| ------------ | -------------------------------------------------------- |
| `src/`       | Application source (app router, features, lib, server)   |
| `src/app/`   | Next.js App Router pages and API routes                  |
| `src/features/` | Domain modules (clients, services, treatment-cycles, etc.) |
| `src/lib/`   | Shared utilities (auth, roles, permissions, env)         |
| `src/server/` | Server-only logic (auth context, commands, services, events, validators) |
| `src/db/`    | Database connection, schema, seed                        |
| `src/components/` | UI components (layout, shared, ui/shadcn)            |
| `drizzle/`   | SQL migrations and meta snapshots                        |
| `tests/`     | Unit, integration, regression, e2e tests and support     |
| `scripts/`   | Build/test helper scripts                                |
| `docs/`      | Phase documentation                                      |
| `.github/`   | CI workflows                                             |
| `public/`    | Static assets                                            |

### Root Files

| File                  | Present |
| --------------------- | ------- |
| `package.json`        | ✓       |
| `package-lock.json`   | ✓       |
| `tsconfig.json`       | ✓       |
| `next.config.ts`      | ✓       |
| `drizzle.config.ts`   | ✓       |
| `vitest.config.mts`   | ✓       |
| `playwright.config.ts`| ✓       |
| `eslint.config.mjs`   | ✓       |
| `compose.test.yml`    | ✓       |
| `.env.example`        | ✓       |
| `README.md`           | ✓       |
| `middleware.ts`        | ✓       |
| `Dockerfile`          | ✗       |

---

## 4. Database Baseline

- **Schema file**: `src/db/schema.ts`
- **Migration count**: 21 (0000–0020)
- **Migration head**: `0020_cycle_commercial_terms`
- **Journal**: `drizzle/meta/_journal.json` — 21 entries, version 7
- **Snapshots**: 21 snapshot JSON files (`0000_snapshot.json` – `0020_snapshot.json`)
- **Migration tests**: `tests/migrations.test.mjs` (runs via `node --test`)

### Manual SQL Objects

Inspected all migration SQL files with:

```bash
grep -RniE \
  'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION|CREATE[[:space:]]+TRIGGER|DROP[[:space:]]+TRIGGER|DROP[[:space:]]+FUNCTION|EXCLUDE[[:space:]]+USING' \
  drizzle/*.sql
```

**Functions:**

| Function | Migration | Purpose |
| -------- | --------- | ------- |
| `pmu_reject_pricing_history_change()` | 0010 | Immutability guard for pricing/offer history rows |
| `pmu_offer_item_creation_only()` | 0010 | Prevents modification of offer items after creation |
| `pmu_check_offer_revision_total()` | 0010 | Validates offer revision total consistency |
| `pmu_phone_key(text)` | 0012 | Normalizes phone for dedup index |
| `pmu_email_key(text)` | 0012 | Normalizes email for dedup index |
| `pmu_instagram_key(text)` | 0012 | Normalizes Instagram handle for dedup index |
| `pmu_name_key(text)` | 0012 | Normalizes name for dedup index |
| `pmu_guard_offer_identity()` | 0013 | Replaces original offer identity guard (allows client_id update for merge) |
| `pmu_lock_cycle_studio()` | 0014 | Locks cycle to its studio on insert/update |
| `pmu_validate_cycle_links()` | 0014 | Validates cycle FK references (client, master, service, offer) |
| `pmu_validate_procedure_cycle()` | 0014 | Validates procedure session cycle link |
| `pmu_cycle_stage_evidence()` | 0015 | Validates stage transition evidence |
| `pmu_cycle_history_receipt()` | 0015 (replaced in 0016, 0018, 0019) | Validates cycle history receipt consistency |
| `pmu_cycle_history_immutable()` | 0015 | Immutability guard for cycle stage history |
| `pmu_consultation_evidence_guard()` | 0016 | Validates consultation evidence |
| `pmu_consultation_immutable()` | 0016 | Immutability guard for consultations |
| `pmu_consultation_task_guard()` | 0016 | Guards consultation task creation |
| `pmu_follow_up_task_guard()` | 0017 (replaced in 0018) | Guards follow-up task creation |
| `pmu_follow_up_revision_guard()` | 0018 | Guards follow-up revision creation |
| `pmu_cycle_review_guard()` | 0019 | Guards cycle review creation |
| `pmu_follow_up_closure_guard()` | 0019 | Guards follow-up closure creation |
| `pmu_commercial_terms_guard()` | 0020 | Guards commercial terms creation |

**Triggers (active after all migrations applied):**

| Trigger | Table | Migration |
| ------- | ----- | --------- |
| `master_price_history_immutable` | `master_price_revisions` | 0010 |
| `offer_identity_immutable` | `custom_offers` | 0013 (replaced from 0010) |
| `offer_revision_immutable` | `offer_revisions` | 0010 |
| `offer_item_immutable` | `offer_items` | 0010 |
| `offer_items_creation_only` | `offer_items` | 0010 |
| `client_merge_history_immutable` | `client_merges` | 0013 |
| `cycle_studio_lock` | `treatment_cycles` | 0014 |
| `cycle_history_immutable` | `cycle_stage_history` | 0015 |
| `qualification_immutable` | `cycle_qualifications` | 0016 |
| `consultation_result_immutable` | `consultation_results` | 0016 |
| `consultation_immutable` | `consultations` | 0016 |
| `follow_up_revision_immutable` | `follow_up_revisions` | 0018 |
| `cycle_review_immutable` | `cycle_reviews` | 0019 |
| `follow_up_closure_immutable` | `follow_up_closures` | 0019 |
| `commercial_terms_immutable` | `cycle_commercial_terms` | 0020 |

**Indexes**: Numerous `CREATE INDEX` and `CREATE UNIQUE INDEX` statements across migrations 0000–0010+. All are Drizzle-generated and represented in snapshots.

**CHECK constraints**: Inline in `CREATE TABLE` statements (e.g., `appointments_end_after_start_check`, `blocked_times_end_after_start_check`, `master_availability_weekday_check`, `master_breaks_weekday_check`, `payment_transactions_amount_cents_check`, `payments_total_amount_cents_check`, `services_price_cents_check`, `services_duration_minutes_check`, `reviews_rating_check`, `procedure_sessions_pain_level_check`). All represented in Drizzle schema.

**Note**: Functions and triggers are NOT represented in Drizzle snapshots and require special preservation during migration operations.

### Migration Inventory

```
0000_windy_the_watchers.sql
0001_rainy_norman_osborn.sql
0002_spicy_captain_midlands.sql
0003_consent_archive_event.sql
0004_seed_identity.sql
0005_role_policy.sql
0006_master_assignment_scope.sql
0007_audit_access_contract.sql
0008_command_reliability.sql
0009_service_catalog.sql
0010_pricing_offers.sql
0011_client_administration.sql
0012_client_deduplication.sql
0013_client_merge.sql
0014_treatment_cycle_foundation.sql
0015_cycle_stage_commands.sql
0016_consultation_decisions.sql
0017_cycle_follow_up_tasks.sql
0018_follow_up_rescheduling.sql
0019_cycle_reassessment.sql
0020_cycle_commercial_terms.sql
```

---

## 5. Existing Architecture

| Domain                    | Status       | Key Modules                                                                 |
| ------------------------- | ------------ | --------------------------------------------------------------------------- |
| Auth                      | IMPLEMENTED  | `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/server/auth/context.ts`   |
| Tenant                    | PARTIAL      | `src/features/studios/server/`, `src/server/auth/context.ts` (`resolveStudio`) — membership validation exists; inactive memberships/studios filtered; Studio-scoped authorization exists; **explicit active Studio selection does not exist**; first-active-membership fallback remains; canonical Phase 1.1 will replace that fallback. |
| RBAC                      | IMPLEMENTED  | `src/lib/roles.ts`, `src/lib/permissions.ts`, `src/features/roles/`, `src/features/permissions/` |
| Audit                     | IMPLEMENTED  | `src/features/audit/server/`, `src/server/services/audit-log.service.ts`, `src/server/services/access-log.service.ts` |
| Idempotency               | IMPLEMENTED  | `src/server/commands/idempotency.ts`                                        |
| Outbox / Worker           | IMPLEMENTED  | `src/server/events/outbox.ts`, `src/server/events/worker.ts`, `src/features/jobs/server/` — durable job queue with leases, retry, dead-letter, recovery UI |
| Clients (Admin)           | IMPLEMENTED  | `src/features/clients/` (administrative, contacts, schemas, server)         |
| Dedup                     | IMPLEMENTED  | Client deduplication via `pmu_phone_key`/`pmu_email_key`/`pmu_instagram_key`/`pmu_name_key` functions + `canonicalClientId` |
| Merge                     | IMPLEMENTED  | `src/features/clients/merge-contract.ts`, server merge logic                |
| Catalog                   | IMPLEMENTED  | `src/features/services/catalog.ts`, `service_definitions` table, server module |
| Pricing                   | IMPLEMENTED  | `src/features/services/price-label.ts`, `master_price_revisions` with immutability triggers |
| Custom Offers             | IMPLEMENTED  | `src/features/offers/` (schema, server, components) with immutability triggers |
| Treatment Cycle Core      | IMPLEMENTED  | `src/features/treatment-cycles/` — cycle entity, per-zone model, guarded stage transitions, history with optimistic versioning, qualification, consultation decisions, Thinking/reassessment/Lost, follow-up scheduling/rescheduling, commercial terms |
| Full Treatment Lifecycle  | PARTIAL      | Later stages depend on: calendar/booking, deposit/ledger, Session 1, Session 2, control, corrections, refresh — none implemented |
| Consultation              | IMPLEMENTED  | `src/features/consultations/` (contracts, server, components)               |
| Commercial Terms          | IMPLEMENTED  | `src/features/commercial-terms/` (contract, server, components)             |
| Appointments (schema)     | FOUNDATION   | Schema tables exist (`appointments`, `appointment_events`, `master_availability`, `master_breaks`, `blocked_times`); read-only queries in `src/features/appointments/server/queries.ts`; no booking command, no availability engine, no slot generator, no collision protection, no reschedule command |
| Payments (schema)         | FOUNDATION   | Schema tables exist (`payments`, `payment_transactions`); read-only queries in `src/features/payments/server/queries.ts`; no mutation commands, no ledger service, no refund, no credit, no balance derivation |
| Media                     | PARTIAL      | `src/features/media/server/` (actions, service); Cloudinary upload; read-side uses `requireStudioPermission` + `resourceScope` + `sensitiveRead`; write-side missing permission/scope checks (see Finding 9.3) |
| Consent                   | PARTIAL      | `src/features/consent/server/` — upload action has permission check (`CONSENT_UPLOAD`); uses `mediaService` for storage; no resource scope on write; read uses permission check |
| Tasks                     | FOUNDATION   | `src/features/tasks/` — schema tables exist (`tasks`), directory present, minimal content |
| Conversations             | ABSENT       | No conversation model found                                                 |
| Automations               | FOUNDATION   | Infrastructure exists: durable outbox/worker (`src/server/events/worker.ts`), event registry (`src/server/events/registry.ts`) with 4 internal handlers (`cycle.follow-up-due.v1`, `consultation.decision-due.v1`, `cycle.stage-recorded.v1`, `client.created.v1`), job recovery UI. **Missing**: all client-facing automations (booking confirmation, -24h reminder, morning reminder, pre-care, post-care, day-3 check-in, healed-photo reminder, review requests, refresh campaign, real outbound transport). |
| Google                    | ABSENT       | No Google Calendar integration                                              |
| AI                        | ABSENT       | No AI runtime or adapter                                                    |
| WhatsApp                  | ABSENT       | No WhatsApp adapter (schema has `whatsapp_templates` table but no transport) |
| Instagram                 | ABSENT       | No Instagram integration                                                    |

---

## 6. Test Baseline

### Test Suites

| Type              | Directory/Files                          | Count |
| ----------------- | ---------------------------------------- | ----- |
| Unit              | `tests/unit/environment.test.ts`         | 1     |
| Integration       | `tests/integration/*.test.ts`            | 14    |
| Regressions       | `tests/regressions/access.test.ts`       | 1     |
| Migration         | `tests/migrations.test.mjs`             | 1     |
| E2E (Playwright)  | `tests/e2e/*.spec.ts`                    | 13    |

### Support Infrastructure

- `tests/support/setup.ts` — test setup
- `tests/support/database.ts` — database harness (PGlite)
- `tests/support/database-url.ts` — Postgres URL resolution
- `tests/support/server-only.ts` — server-only mock
- `tests/support/browser-auth.ts` — browser auth helper for e2e
- `tests/fixtures/studio.ts` — studio fixture

### Package Scripts

| Script             | Command                                          |
| ------------------ | ------------------------------------------------ |
| `typecheck`        | `tsc --noEmit`                                   |
| `lint`             | `eslint .`                                       |
| `test`             | `npm run test:migrations && vitest run`           |
| `test:unit`        | `vitest run tests/unit`                           |
| `test:integration` | `vitest run tests/integration`                    |
| `test:postgres`    | `REQUIRE_POSTGRES=1 vitest run tests/integration` |
| `test:regressions` | `vitest run tests/regressions`                    |
| `test:e2e`         | `playwright test`                                 |
| `test:e2e:http`    | `playwright test --grep HTTP:`                    |
| `build`            | `next build`                                      |
| `build:test`       | `node scripts/build-test.mjs`                     |
| `test:migrations`  | `node --test tests/migrations.test.mjs`           |

---

## 7. CI Baseline

**Single workflow**: `.github/workflows/ci.yml`

| Aspect              | Detail                                                    |
| ------------------- | --------------------------------------------------------- |
| Trigger             | `push`, `pull_request`                                    |
| Node version        | From `.nvmrc`                                             |
| PostgreSQL service  | `postgres:17` on port 5432                                |
| Install             | `npm ci`                                                  |
| Seed check          | `node --conditions=react-server --import tsx -e '...'`    |
| Typecheck           | `npm run typecheck`                                       |
| Lint                | `npm run lint`                                            |
| Tests               | `npm test` (migrations + vitest, `REQUIRE_POSTGRES=1`)    |
| Build               | `npm run build:test`                                      |
| Playwright          | `npx playwright install --with-deps chromium` → `npm run test:e2e` |
| Artifact upload     | `playwright-report/`, `test-results/` on failure (7 days) |
| Security/dep checks | None                                                      |

---

## 8. Environment Contract

### Variable Categories

| Category      | Variables                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------ |
| Application   | `NEXT_PUBLIC_APP_URL`                                                                      |
| Database      | `DATABASE_URL`, `TEST_DATABASE_URL`                                                        |
| Auth          | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`                                                     |
| Cloudinary    | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`                     |
| Worker        | `WORKER_SECRET`                                                                            |
| Seed          | `SEED_STUDIO_NAME`, `SEED_STUDIO_SLUG`, `SEED_STUDIO_COUNTRY`, `SEED_STUDIO_CITY`, `SEED_STUDIO_TIMEZONE`, `SEED_ADMIN_EMAIL`, `SEED_DEMO_SERVICES`, `SEED_PHASE3_CATALOG` |
| CI-only       | `REQUIRE_POSTGRES`, `NEXT_TELEMETRY_DISABLED`                                              |

No Google, Meta/WhatsApp, OpenAI, or AI-related environment variables present.

**No secret values are included in this document.**

---

## 9. Confirmed Open Findings

### 9.1 Studio Context Fallback

- **Finding**: `resolveStudio()` in `src/server/auth/context.ts` selects the first active studio membership (ordered by `createdAt`) when no explicit `requestedStudioId` is provided.
- **Evidence**: No explicit studio selection mechanism (cookie, header, query param) observed; fallback is implicit.
- **Risk**: Multi-studio users may silently operate in the wrong studio context.
- **Planned phase**: OPEN — scheduled for Phase 1.1

### 9.2 Legacy Client Status

- **Finding**: `clientStatusEnum` and `clientStatus` column exist on the clients table alongside `TreatmentCycle.stage`. `clientStatusHistory` table also exists.
- **Evidence**: `src/db/schema.ts` lines 316, 629, 726. Comment at line 1553 notes: "Phase 3.1 foundation. No migration invents cycles from clientStatus or legacy visits."
- **Risk**: Dual status tracking may cause inconsistency.
- **Planned phase**: OPEN — scheduled for Phase 2.1

### 9.3 Upload Authorization — Full Surface

Three independent upload entry points exist. Each is documented below.

#### 9.3.1 `src/app/api/upload/image/route.ts`

| Check | Present |
| ----- | ------- |
| Session/auth | ✓ (`getSession()`) |
| Active Studio membership | ✗ |
| Capability/permission | ✗ |
| Client/resource scope | ✗ |
| Studio-derived storage namespace | ✗ (hardcoded `crm-pmu/general` folder) |
| Size validation | ✓ (5 MB max) |
| MIME allowlist | PARTIAL (`file.type.startsWith("image/")` — trusts client-provided Content-Type) |
| Actual-content validation | ✗ |
| Provider I/O timing | Upload to Cloudinary happens after session check but before any authorization |
| DB compensation | ✗ (no DB record created; no rollback) |
| Error redaction | ✗ (`error.message` returned directly) |
| Audit | ✗ |

**This is the most permissive path**: any authenticated user (regardless of studio membership) can upload arbitrary images to a shared Cloudinary folder.

#### 9.3.2 `src/app/api/media/upload/route.ts` → `uploadMediaAction`

| Check | Present |
| ----- | ------- |
| Session/auth | ✓ (`getSession()`) |
| Active Studio membership | ✓ (`getCurrentStudioId()` — but uses first-active fallback) |
| Capability/permission | ✗ (no `requireStudioPermission` call) |
| Client/resource scope | ✗ (no `resourceScope` check; any client ID accepted) |
| Studio-derived storage namespace | ✓ (Cloudinary folder includes studioId) |
| Size validation | ✗ |
| MIME allowlist | ✗ |
| Actual-content validation | ✗ |
| Provider I/O timing | Cloudinary upload occurs before DB insert (within `withMediaUpload`) |
| DB compensation | ✓ (rollback deletes Cloudinary asset on DB failure) |
| Error redaction | ✗ (`error` re-thrown with original message) |
| Audit | ✗ on write (read-side `getClientMediaAction` uses `sensitiveRead`) |

#### 9.3.3 `uploadConsentAction` (`src/features/consent/server/actions.ts`)

| Check | Present |
| ----- | ------- |
| Session/auth | ✓ (`getSession()`) |
| Active Studio membership | ✓ (`getCurrentStudioId()`) |
| Capability/permission | ✓ (`hasPermission(CONSENT_UPLOAD)`) |
| Client/resource scope | ✗ (no `resourceScope`; any client ID accepted if permission granted) |
| Studio-derived storage namespace | ✓ (via `mediaService` / `withMediaUpload`) |
| Size validation | ✗ |
| MIME allowlist | ✗ |
| Actual-content validation | ✗ |
| Provider I/O timing | Cloudinary upload before DB insert |
| DB compensation | ✓ (via `withMediaUpload`) |
| Error redaction | ✗ |
| Audit | ✓ (`writeAudit` + `writeActivity` in service) |

**Summary**: No upload path validates actual file content. Only the `/api/upload/image` route checks size/MIME (client-provided). Only consent upload checks permissions. No path enforces resource scope on write. The `/api/upload/image` route bypasses studio context entirely.

- **Risk**: Unauthorized uploads, cross-studio data leakage, arbitrary file storage.
- **Planned phase**: OPEN — scheduled for canonical media phase

### 9.4 Private Media

- **Finding**: Media is uploaded to Cloudinary via `cloudinary` SDK. No evidence of:
  - Private/authenticated delivery mode
  - Signed short-lived URLs
  - Sensitive access logging on media write (read actions do use `sensitiveRead` via `getClientMediaAction`)
- **Evidence**: `src/features/media/server/service.ts` uses standard Cloudinary upload; URLs are public by default.
- **Risk**: Sensitive client photos (before/after, medical) accessible via public URLs.
- **Planned phase**: OPEN — scheduled for canonical media phase

### 9.5 Calendar / Booking

- **Finding**: Schedule-related schema foundation exists in `src/db/schema.ts`:
  - `masterAvailability` (`master_availability`) — weekday-based availability slots per master
  - `masterBreaks` (`master_breaks`) — weekday-based break periods per master
  - `blockedTimes` (`blocked_times`) — date-range blocked periods per master
  - `appointments` table with status enum, start/end times, CHECK constraint
  - `appointmentEvents` table for event history
- **Evidence**: Tables defined in schema and created in migration `0000_windy_the_watchers.sql`. Read-only queries exist in `src/features/appointments/server/queries.ts` with proper scope/audit. `src/features/calendar/` directory exists but is empty.
- **What is missing**:
  - No authoritative `getAvailability()` engine
  - No slot generator
  - No preferred-slot ranking engine
  - No atomic `bookAppointment()` command
  - No PostgreSQL collision protection (no `EXCLUDE USING` or advisory locks)
  - No canonical reschedule command/history
- **Status**: FOUNDATION — schema exists, no business engine
- **Planned phase**: OPEN — scheduled for canonical appointments phase

### 9.6 Ledger

- **Finding**: `src/features/payments/server/queries.ts` provides read-only payment/transaction queries with scope and audit. Schema tables `payments` and `payment_transactions` exist with CHECK constraints.
- **Evidence**: No immutable posting service, no client credit, no refund logic, no balance derivation.
- **Risk**: No financial mutation capability.
- **Planned phase**: OPEN — scheduled for canonical payments phase

### 9.7 AI / Integrations

- **Finding**: No AI runtime, no WhatsApp adapter, no Google Calendar integration, no conversation model, no Instagram/Facebook integration found anywhere in the codebase.
- **Evidence**: No related directories, imports, env vars, or configuration. `whatsapp_templates` table exists in schema but no transport adapter.
- **Risk**: None (features not yet expected).
- **Planned phase**: OPEN — scheduled for canonical integrations phase

---

## 10. Reproduction Commands

```bash
# Repository state
git status --short --branch
git rev-parse HEAD
git branch --show-current
git log -1 --oneline --decorate
git remote -v

# Runtime
node --version
npm --version

# Migration inventory
ls drizzle/*.sql
cat drizzle/meta/_journal.json | python3 -c "import json,sys; j=json.load(sys.stdin); print(len(j['entries']), j['entries'][-1])"

# Manual SQL objects
grep -RniE \
  'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION|CREATE[[:space:]]+TRIGGER|DROP[[:space:]]+TRIGGER|DROP[[:space:]]+FUNCTION|EXCLUDE[[:space:]]+USING' \
  drizzle/*.sql

# Schedule schema
grep -n 'master_availability\|master_breaks\|blocked_times\|masterAvailability\|masterBreaks\|blockedTimes' src/db/schema.ts

# Upload surfaces
cat src/app/api/upload/image/route.ts
cat src/app/api/media/upload/route.ts
cat src/features/media/server/actions.ts
cat src/features/consent/server/actions.ts

# Event/worker registry
cat src/server/events/registry.ts

# Test inventory
ls tests/unit/ tests/integration/ tests/regressions/ tests/e2e/

# CI
cat .github/workflows/ci.yml

# Environment contract
cat .env.example
```

---

## 11. Scope Boundary

> No business logic, schema, migration, dependency, security behavior or runtime behavior was intentionally changed in Phase 0.1.

The only file created/modified is `docs/phase4/CANONICAL-BASELINE.md`.
