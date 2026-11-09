# Phase 0.3 — Full Baseline Test Run

## 1. Baseline Identity

- **Branch**: `main`
- **HEAD Commit**: `c260452ca4d614fae926a973c2717476cacd7df8` (`Merge pull request #19 from ZigranN/codex/phase-3-offer-terms`)
- **Migration Head**: `0020_cycle_commercial_terms`
- **Migration Count**: 21 migrations (`0000_windy_the_watchers` through `0020_cycle_commercial_terms`)

## 2. Runtime / Toolchain

- **Node.js**: `v22.22.2` (via nvm)
- **npm**: `10.9.7`
- **.nvmrc Specification**: `22.22.2`
- **package.json Engine Specification**: `node: ">=22.22.2 <23"`
- **Historical Note**: Initial preflight execution ran under Node `v20.19.4` / npm `10.8.2` which triggered `EBADENGINE`. Runtime was switched to canonical `v22.22.2` and fully reverified.
- **Next.js**: `16.2.6`
- **React**: `19.2.4`
- **TypeScript**: `5.9.3`
- **Drizzle ORM**: `0.45.2`
- **Drizzle Kit**: `0.31.10`
- **Vitest**: `4.1.11`
- **Playwright**: `1.63.0`

## 3. Dependency Installation

- **Command**: `npm ci` (under Node `v22.22.2`)
- **Exit Code**: `0`
- **Summary**: Added 898 packages, audited 899 packages in 12s.
- **Engine Warning**: Clean execution with zero `EBADENGINE` warnings.
- **Package Lock Stability**: `package.json` and `package-lock.json` remained strictly unchanged (`git diff -- package.json package-lock.json` returned 0 differences).

## 4. Environment Safety

- **Database URL Validation**: `tests/support/database-url.ts` strictly validates that `TEST_DATABASE_URL` connects exclusively to loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) targeting database names matching `^/pmu_test(?:_[a-z0-9_]+)?$` with no query options or URL hash fragments.
- **Provider & Secret Isolation**: Local environment defaults and `.env.example` configurations isolate test execution from production infrastructure (Neon, Vercel, Cloudinary, WhatsApp, Google, OpenAI).

## 5. PostgreSQL Test Environment

- **Docker Compose Service**: `pmu-crm-tests-postgres-1` (`compose.test.yml`)
- **Container State**: `Up (healthy)`
- **Port Mapping**: `127.0.0.1:5433->5432/tcp`
- **Database Engine**: `PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`

## 6. Migration Verification

- **Phase 0.2 Verification Suite**: `node --test tests/phase02-pg-verify.mjs`
  - **Result**: `18/18` subtests passed (Exit code: 0).
  - **Reconciliation**: 21 journal entries, 21 SQL migration files, 21 snapshots, 0 gaps, 0 orphans.
  - **Deterministic Drift**: 0 true drift across 66 tables, 759 columns, 66 primary keys, 181 foreign keys, 5 unique constraints, 43 check constraints, 97 indexes, and 33 enums.
- **Standard Migration Suite**: `npm run test:migrations` (`node --test tests/migrations.test.mjs`)
  - **Result**: `4/4` subtests passed (Exit code: 0).

## 7. Typecheck

- **Command**: `npm run typecheck` (`tsc --noEmit`)
- **Exit Code**: `0`
- **Errors**: 0 TypeScript errors.

## 8. Lint

- **Command**: `npm run lint` (`eslint .`)
- **Exit Code**: `0`
- **Errors**: 0 errors.
- **Warnings**: 0 warnings.

## 9. Dependency Security Observation

- **Command**: `npm audit`
- **Exit Code**: `1` (advisory report inventory)
- **Vulnerability Breakdown**:
  - Total: 19 vulnerabilities
  - Critical: 1
  - High: 9
  - Moderate: 7
  - Low: 2
- **Key Affected Packages**: `next` (middleware/proxy bypass, SSRF), `better-auth` (stored XSS, account takeover vectors), `hono` / `@hono/node-server`, `sharp` (libvips/libheif).
- **Classification**: `OPEN SECURITY FINDING`
- **Target Remediation Phase**: `PHASE 1.5 Dependency Security Gate`
- **Remediation Policy**: Informational baseline observation only; no package changes or automated fixes applied during Phase 0.3 per boundary rules.

## 10. Unit Tests

- **Script Definition**: `"test:unit": "vitest run tests/unit"`
- **Command**: `npm run test:unit`
- **Exit Code**: `0`
- **Duration**: `490ms`
- **Files Passed**: `1 / 1` (`tests/unit/environment.test.ts`)
- **Tests Breakdown**: `6 passed, 0 failed, 0 skipped` (6 total)
- **Coverage**: Process environment constraints, client vs server credential boundaries, fake secret guards, external URL format contracts.

## 11. Integration Tests

- **Script Definition**: `"test:integration": "vitest run tests/integration"`
- **Command**: `npm run test:integration`
- **Exit Code**: `0`
- **Duration**: `24.87s`
- **Harness**: PGlite (`@electric-sql/pglite` in-memory PostgreSQL engine)
- **Files Passed**: `14 / 14`
- **Tests Breakdown**: `217 passed, 0 failed, 0 skipped` (217 total)
- **Executed Files**:
  - `tests/integration/consultations.test.ts` (50 tests)
  - `tests/integration/pricing-offers.test.ts` (28 tests)
  - `tests/integration/master-scope.test.ts` (18 tests)
  - `tests/integration/command-reliability.test.ts` (18 tests)
  - `tests/integration/cycle-commands.test.ts` (16 tests)
  - `tests/integration/client-merge.test.ts` (15 tests)
  - `tests/integration/mutations.test.ts` (14 tests)
  - `tests/integration/client-deduplication.test.ts` (13 tests)
  - `tests/integration/service-catalog.test.ts` (11 tests)
  - `tests/integration/treatment-cycles.test.ts` (10 tests)
  - `tests/integration/role-policy.test.ts` (9 tests)
  - `tests/integration/client-administration.test.ts` (9 tests)
  - `tests/integration/seed.test.ts` (3 tests)
  - `tests/integration/baseline.test.ts` (3 tests)

## 12. PostgreSQL Integration Tests

- **Script Definition**: `"test:postgres": "REQUIRE_POSTGRES=1 vitest run tests/integration"`
- **Command**: `TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:postgres`
- **Exit Code**: `0`
- **Duration**: `24.34s`
- **Engine**: PostgreSQL 17.11 (Docker container `pmu-crm-tests-postgres-1` on loopback port `5433`)
- **Files Passed**: `14 / 14`
- **Tests Breakdown**: `217 passed, 0 failed, 0 skipped` (217 total)
- **Outcome**: The same executed 217-test integration suite passed on both PGlite and PostgreSQL 17.

## 13. Regression Tests

- **Script Definition**: `"test:regressions": "vitest run tests/regressions"`
- **Command**: `npm run test:regressions`
- **Exit Code**: `0`
- **Duration**: `853ms`
- **Files Passed**: `1 / 1` (`tests/regressions/access.test.ts`)
- **Tests Breakdown**: `14 passed, 0 failed, 0 skipped` (14 total)
- **Coverage**: Multi-tenant studio isolation, unauthenticated caller blocking, non-member access prevention, cross-studio search rejection, user custom permission overrides (deny taking precedence over allow), sensitive health/medical history masking, and consent attachment privacy.

## 14. Canonical Main Test Command

- **Script Definition**: `"test": "npm run test:migrations && vitest run"`
- **Command**: `npm test`
- **Exit Code**: `0`
- **Duration**: `24.57s`
- **Constituent Suites**:
  1. `npm run test:migrations` (`tests/migrations.test.mjs`): 4 tests passed (0 fail, 0 skip)
  2. `vitest run` (`tests/{unit,integration,regressions}/**/*.test.ts`): 16 test files, 237 tests passed (0 fail, 0 skip)
- **Unified Total**: `17 test files, 241 tests passed (241 total, 0 failed, 0 skipped)`

## 15. Isolation / Repeat Runs

- **Repeat Integration Run (`npm run test:integration`)**:
  - **Exit Code**: `0`
  - **Result**: `14 / 14 files passed, 217 / 217 tests passed` (Duration: `23.64s`)
- **Repeat PostgreSQL Run (`npm run test:postgres`)**:
  - **Exit Code**: `0`
  - **Result**: `14 / 14 files passed, 217 / 217 tests passed` (Duration: `23.82s`)
- **Isolation Assessment**: Zero state leakage, zero inter-test contamination, and 100% idempotent setup/teardown across successive suite executions.

## 16. Flakiness

- **Flaky Tests Count**: `0`
- **Classification**: Clean PASS across all initial and repeated suite executions.

## 17. Coverage Inventory

### Verified Existing Coverage:
- **Authentication & Sessions**: Better Auth signup, session validation, invalid password rejection (`baseline.test.ts`).
- **RBAC & Custom Permissions**: Role hierarchies, studio permissions, user custom permission allow/deny overrides (`role-policy.test.ts`, `access.test.ts`).
- **Tenant Isolation & Access Security**: Cross-tenant data masking, non-member query rejection, foreign studio ID enforcement (`access.test.ts`).
- **Audit Logging & Sensitive Reads**: Audit log integrity, action provenance, sensitive read interception (`access.test.ts`, `mutations.test.ts`).
- **Command Idempotency & Reliability**: Command receipt creation, hash validation, duplicate payload handling, error capturing (`command-reliability.test.ts`, `cycle-commands.test.ts`).
- **Client Administration**: Client profile creation, metadata updates, status lifecycle, phone normalization (`client-administration.test.ts`).
- **Client Deduplication**: Multi-field normalization (phone, name, email, instagram), collision detection, similarity searches (`client-deduplication.test.ts`).
- **Client Merge**: Target/source record consolidation, foreign key re-pointing, audit provenance, merge review token protection (`client-merge.test.ts`).
- **Master Scope & Management**: Master scheduling boundaries, role assignment, studio association (`master-scope.test.ts`).
- **Service Catalog**: Service creation, versioning, catalog codes, procedure area/type associations, duration buffers (`service-catalog.test.ts`).
- **Pricing & Custom Offers**: Dynamic pricing, price revision numbering, custom offer generation, revision items, expiration transitions (`pricing-offers.test.ts`).
- **Treatment Cycles**: Stage lifecycles, zone associations, stage transition validation, historical audit trail (`treatment-cycles.test.ts`, `cycle-commands.test.ts`).
- **Consultations & Tasks**: Consultation recording, task lifecycle, guard rules, procedure prerequisites (`consultations.test.ts`).
- **Media & Consents**: Media upload, deletion, client photo associations, consent access gates (`mutations.test.ts`).
- **Migration & Schema Continuity**: Migration execution, snapshot lineage, structural idempotency, data upgrades (`migrations.test.mjs`, `phase02-pg-verify.mjs`).

### Major Domains with Little or No Automated Test Coverage (Informational):
- Availability and real-time calendar scheduling engine (slot generation, master conflict arbitration).
- End-to-end client booking lifecycle (external client portal, confirmation links, webhooks).
- Immutable financial ledger (double-entry bookkeeping, multi-currency ledger adjustments).
- Medical Clearance V2 & Digital Consent V2 (electronic signatures, multi-step questionnaires).
- Specialized treatment pipelines (Total Face, Chemical/Laser Remover specific multi-session flows).
- Real-time conversation threads & channel gateway integrations (WhatsApp, Telegram, SMS, Google Calendar).
- AI Assistant dispatching & automated consultation note generation.
- Real-time studio dashboard analytics & aggregate revenue reporting.

## 18. Build Test

- **Script Definition**: `"build:test": "node scripts/build-test.mjs"`
- **Command**: `npm run build:test`
- **Exit Code**: `0`
- **Duration**: `~9.3s`
- **Compiler**: Next.js 16.2.6 (Turbopack)
- **Compilation Output**:
  - Compiled successfully in `3.0s`
  - TypeScript type validation finished in `5.8s`
  - 23 static pages generated in `175ms`
  - Total Routes: 33 routes (27 dynamic server-rendered, 5 static prerendered, 1 middleware proxy)
- **Build Errors / Route Errors / Warnings**: 0

## 19. Production Build

- **Script Definition**: `"build": "next build"`
- **Command**: `npm run build`
- **Exit Code**: `0`
- **Duration**: `~8.8s`
- **Compiler**: Next.js 16.2.6 (Turbopack)
- **Compilation Output**:
  - Compiled successfully in `2.9s`
  - TypeScript type validation finished in `5.6s`
  - 23 static pages generated in `171ms`
  - Total Routes: 33 routes (identical route map to `build:test`)
- **Operational Finding**: A bare `npm run build` can overwrite `.next` with normal/default client build settings. The E2E workflow must use the repository's `build:test` artifact/environment before Playwright.

## 20. Playwright Configuration

- **Configuration File**: `playwright.config.ts`
- **Playwright Package Version**: `1.63.0`
- **Test Directory**: `./tests/e2e`
- **Browser Projects**: `chromium` (`Desktop Chrome` device descriptor)
- **Workers**: `1` (sequential test execution for complete database safety)
- **Retries**: `0` (`forbidOnly: !!process.env.CI`, `retries: 0`)
- **Reporter**: `[["list"], ["html", { open: "never" }]]`
- **Base URL**: `http://127.0.0.1:3100`
- **Tracing**: `retain-on-failure`
- **WebServer Management**:
  - Command: `npm run start -- --hostname 127.0.0.1 --port 3100`
  - Healthcheck URL: `http://127.0.0.1:3100/login`
  - Timeout: `60000ms`
  - Reuse Existing Server: `false`
  - Injected Environment: `testEnvironment` with `DATABASE_URL` dynamically asserted via `assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)`

## 21. Full Playwright E2E

- **Script Definition**: `"test:e2e": "playwright test"`
- **Command**: `TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:e2e`
- **Exit Code**: `0`
- **Duration**: `58.6s`
- **Spec Files**: `13 / 13 passed`
- **Total Tests**: `19 passed, 0 failed, 0 skipped, 0 retries` (19 total)
- **Executed Specs**:
  - `tests/e2e/auth-smoke.spec.ts` (5 tests passed: form usability, rejected credentials, anonymous redirect, empty session, forged cookie protection)
  - `tests/e2e/client-administration.spec.ts` (1 test passed: mobile client qualification, preferred master selection, medical data immutability)
  - `tests/e2e/client-command.spec.ts` (1 test passed: client command dispatching and status transitions)
  - `tests/e2e/client-deduplication.spec.ts` (2 tests passed: duplicate detection, manual merge resolution)
  - `tests/e2e/client-merge.spec.ts` (1 test passed: complete client merge workflow with provenance preservation)
  - `tests/e2e/commercial-terms.spec.ts` (1 test passed: commercial terms configuration and revision tracking)
  - `tests/e2e/consultations.spec.ts` (1 test passed: consultation recording and task scheduling)
  - `tests/e2e/cycle-commands.spec.ts` (2 tests passed: treatment cycle stage commands and receipts)
  - `tests/e2e/master-edit.spec.ts` (1 test passed: master profile editing and schedule buffer management)
  - `tests/e2e/master-scope.spec.ts` (1 test passed: multi-tenant master assignment, mobile scoping, private client isolation)
  - `tests/e2e/pricing-offers.spec.ts` (1 test passed: custom offer creation and multi-item revision lifecycle)
  - `tests/e2e/service-catalog.spec.ts` (1 test passed: service catalog creation and code assignment)
  - `tests/e2e/treatment-cycles.spec.ts` (1 test passed: treatment cycle inspection and legacy visit matching)

## 22. HTTP E2E

- **Script Definition**: `"test:e2e:http": "playwright test --grep HTTP:"`
- **Command**: `TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:e2e:http`
- **Exit Code**: `0`
- **Duration**: `806ms`
- **Spec Files**: `1 / 1 passed` (`tests/e2e/auth-smoke.spec.ts`)
- **Tests**: `3 passed, 0 failed, 0 skipped, 0 retries` (3 total)
- **Executed Tests**:
  - `HTTP: anonymous protected route redirects without database access`
  - `HTTP: login renders and anonymous auth session is empty`
  - `HTTP: forged session cookie cannot open client data`

## 23. CI Parity

Ordered comparison against `.github/workflows/ci.yml`:

| CI Step | Exact CI Command | Already Executed | Result | Evidence |
| --- | --- | --- | --- | --- |
| Checkout | `actions/checkout@v4` | CI-Only Infrastructure | PASS | Git repository initialized at commit `c260452ca4d614fae926a973c2717476cacd7df8` |
| Node Setup | `actions/setup-node@v4` (node-version-file: `.nvmrc`) | Yes (Node 22.22.2 active) | PASS | `node --version` = `v22.22.2`, `npm --version` = `10.9.7` |
| PostgreSQL Service | `postgres:17` container on port 5432 / 5433 | Yes (`compose.test.yml`) | PASS | `docker compose ps` shows `postgres:17` healthy on port `5433` |
| Dependency Install | `npm ci` | Yes (Phase 0.3A) | PASS | Exit code 0; 0 package-lock changes; 0 EBADENGINE warnings |
| Seed Runtime Import | `DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/pmu_test node --conditions=react-server --import tsx -e 'require("./src/db/seed-core.ts")'` | Yes (Phase 0.3D) | PASS | Exit code 0; clean module import without DB connection |
| Typecheck | `npm run typecheck` | Yes (Phase 0.3A) | PASS | Exit code 0; 0 TypeScript errors |
| Lint | `npm run lint` | Yes (Phase 0.3A) | PASS | Exit code 0; 0 errors, 0 warnings |
| Main Test Suite | `npm test` | Yes (Phase 0.3B) | PASS | Exit code 0; 17 files, 241/241 passed |
| Test Build Path | `npm run build:test` | Yes (Phase 0.3C) | PASS | Exit code 0; 33 routes compiled cleanly |
| Playwright Chromium Install | `npx playwright install --with-deps chromium` | Yes (Phase 0.3C) | PASS | Exit code 0; Chromium v1243 installed |
| Full E2E Suite | `npm run test:e2e` | Yes (Phase 0.3C) | PASS | Exit code 0; 13 spec files, 19/19 passed, 0 retries |
| Upload Failure Artifacts | `actions/upload-artifact@v4` (`if: failure()`) | CI-Only Infrastructure | N/A | Triggered only on failure in CI environment; local execution passed cleanly |

## 24. Seed Validation

- **Offline Import Check Command**: `DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/pmu_test node --conditions=react-server --import tsx -e 'require("./src/db/seed-core.ts")'`
- **Exit Code**: `0`
- **Result**: Validates that core database seed definitions can be imported in a React Server condition without initiating eager database network connections.
- **Integration Seed Tests (`tests/integration/seed.test.ts`)**:
  - `seed repeats without duplicates and preserves edited studio and demo records` (PASS)
  - `legacy demo rows are adopted without changing identity or price; ambiguity rolls back` (PASS)
  - `seed links a registered admin once and does not reactivate an existing membership` (PASS)

## 25. Known Baseline Findings

### Baseline Quality Gates (Verified Passing):
- Canonical Node 22.22.2 runtime, deterministic dependency installation, package-lock immutability.
- Strict test database loopback and naming safety policy.
- Full migration chain reconciliation (`0000 → 0020`), zero schema drift against `0020_snapshot.json`.
- Historical data upgrade preservation across all three checkpoints (`0008`, `0013`, `0019`).
- Custom `pmu_*` SQL functions and immutable DB triggers actively enforced.
- Static quality gates: 0 TypeScript errors, 0 ESLint errors/warnings.
- Test suites: unit (6/6), integration under PGlite (217/217) and PostgreSQL 17 (217/217), regressions (14/14), unified `npm test` (241/241), Playwright E2E (19/19), HTTP E2E (3/3).
- 100% CI command parity verified locally.

### Known Architectural & Product Gaps (From Accepted Phase 0.1 Baseline):
- **Implicit Studio Fallback**: Multi-tenant resolution falls back implicitly to the user's first active studio rather than enforcing an explicit active studio context header/selector.
- **Upload Authorization & Media Gaps**: Media uploads lack granular per-studio quota enforcement and strict authorization policy verification.
- **Public Media Delivery**: Uploaded client media assets are served publicly rather than via signed, time-limited URLs.
- **Dual Status Architecture**: Coexistence of legacy `clientStatus` fields alongside Treatment Cycle stage lifecycles.
- **Incomplete Appointment Engine**: Absence of calendar slot arbitration, buffer conflict detection, and schedule concurrency locking.
- **Missing Availability Engine**: Absence of dynamic master shift availability computation and multi-zone capacity planning.
- **Missing Immutable Financial Ledger**: Transaction records exist but lack double-entry ledger balance constraints and multi-currency adjustment tracking.
- **Medical Clearance V2 & Consent V2 Absent**: Digital signatures, structured health questionnaire workflows, and procedure-specific contraindication matrices are not yet implemented.
- **Conversations / AI / Integrations Absent**: Real-time omnichannel communication (WhatsApp, Telegram) and AI assistant modules are unimplemented stubs.

## 26. Known Limitations

- Production / remote Neon PostgreSQL catalog was not inspected in this local phase.
- Third-party external provider services (e.g. live Cloudinary mutations, WhatsApp gateways, Google Calendar, OpenAI) were not connected to live external endpoints.
- Dependency vulnerability remediation is deferred to `PHASE 1.5 Dependency Security Gate`.

## 27. Commands Run

```text
Command: nvm use 22.22.2 && node --version && npm --version && git rev-parse HEAD && git branch --show-current
Exit code: 0
Result: Node v22.22.2, npm 10.9.7, HEAD c260452ca4d614fae926a973c2717476cacd7df8, branch main

Command: node -e "const j=require('./drizzle/meta/_journal.json'); console.log('count=',j.entries.length); console.log('head=',j.entries.at(-1)?.tag);"
Exit code: 0
Result: count= 21, head= 0020_cycle_commercial_terms

Command: npm ci
Exit code: 0
Result: 898 packages added, 0 lockfile diffs, 0 EBADENGINE warnings

Command: node --test tests/phase02-pg-verify.mjs
Exit code: 0
Result: 18 tests passed, 0 failed (0 true drift)

Command: npm run test:migrations
Exit code: 0
Result: 4 tests passed, 0 failed

Command: npm run typecheck
Exit code: 0
Result: 0 errors

Command: npm run lint
Exit code: 0
Result: 0 errors, 0 warnings

Command: npm run test:unit
Exit code: 0
Result: 1 file, 6 tests passed

Command: npm run test:integration
Exit code: 0
Result: 14 files, 217 tests passed (PGlite)

Command: TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:postgres
Exit code: 0
Result: 14 files, 217 tests passed (PostgreSQL 17)

Command: npm run test:regressions
Exit code: 0
Result: 1 file, 14 tests passed

Command: npm test
Exit code: 0
Result: 17 files, 241 tests passed

Command: DATABASE_URL="postgresql://invalid:invalid@127.0.0.1:1/pmu_test" node --conditions=react-server --import tsx -e 'require("./src/db/seed-core.ts")'
Exit code: 0
Result: Seed runtime imported without database connection

Command: npm run build:test
Exit code: 0
Result: Next.js compiled 33 routes in 3.0s, 0 errors, 0 warnings

Command: npm run build
Exit code: 0
Result: Next.js compiled 33 routes in 2.9s, 0 errors, 0 warnings

Command: npx playwright install --with-deps chromium
Exit code: 0
Result: Chromium v1243 and dependencies verified

Command: TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:e2e
Exit code: 0
Result: 13 spec files, 19 tests passed, 0 retries

Command: TEST_DATABASE_URL="postgresql://pmu_test:local-only@127.0.0.1:5433/pmu_test" npm run test:e2e:http
Exit code: 0
Result: 1 spec file, 3 tests passed, 0 retries

Command: git diff --check && git status --short --branch && git diff --name-only
Exit code: 0
Result: Clean diff, 0 tracked modifications
```

## 28. Final Acceptance Evidence

| Criterion | PASS / FAIL / N/A | Evidence |
| --- | --- | --- |
| Canonical branch verified | PASS | Branch `main`, HEAD `c260452ca4d614fae926a973c2717476cacd7df8` |
| Canonical commit verified | PASS | `git rev-parse HEAD` = `c260452ca4d614fae926a973c2717476cacd7df8` |
| Migration head verified | PASS | `0020_cycle_commercial_terms` (entry idx 20) |
| Node 22.22.2 verified | PASS | `node --version` = `v22.22.2` (matching `.nvmrc` and `package.json` engines) |
| `npm ci` passes | PASS | Deterministic install completed in 12s with 0 `EBADENGINE` warnings |
| Dependency files unchanged | PASS | `package.json` and `package-lock.json` diff is empty |
| Migration verification passes | PASS | `node --test tests/phase02-pg-verify.mjs` passed 18/18 subtests |
| Migration suite passes | PASS | `npm run test:migrations` passed 4/4 subtests |
| Typecheck passes | PASS | `npm run typecheck` (`tsc --noEmit`) exited 0 with 0 errors |
| Lint passes | PASS | `npm run lint` (`eslint .`) exited 0 with 0 errors/warnings |
| Unit tests pass | PASS | `npm run test:unit` passed 6/6 tests in 1 file |
| Integration tests pass | PASS | `npm run test:integration` passed 217/217 tests in 14 files under PGlite |
| PostgreSQL integration tests pass | PASS | `npm run test:postgres` passed 217/217 tests in 14 files under PostgreSQL 17 |
| Regression tests pass | PASS | `npm run test:regressions` passed 14/14 tests in 1 file |
| `npm test` passes | PASS | `npm test` passed all 241 tests across 17 files |
| Repeat integration tests pass | PASS | Second run passed 217/217 tests with zero state leakage |
| Repeat PostgreSQL tests pass | PASS | Second run passed 217/217 tests with zero state leakage |
| No observed unexplained flakiness | PASS | 0 flaky tests and 0 retries across unit, integration, and E2E suites |
| `build:test` passes | PASS | `npm run build:test` generated 33 routes cleanly with Turbopack |
| Production build passes | PASS | `npm run build` generated 33 routes cleanly with Turbopack |
| Full Playwright E2E passes | PASS | `npm run test:e2e` passed 19/19 tests across 13 spec files |
| HTTP E2E passes | PASS | `npm run test:e2e:http` passed 3/3 tests across 1 spec file |
| Seed validation passes | PASS | Offline seed import check and 3 integration seed tests passed cleanly |
| All executable CI steps matched locally | PASS | 100% of executable CI commands matched and verified locally |
| CI-only artifact steps classified correctly | PASS | GitHub Actions checkout, service binding, and failure artifact upload classified as CI-only infrastructure |
| No production DB/provider used | PASS | Strictly validated loopback test database URL via `assertTestDatabaseUrl` |
| No application business source changed | PASS | `git diff --name-only src/` is empty |
| Historical migrations unchanged | PASS | `git diff --name-only drizzle/` is empty |
| Snapshots unchanged | PASS | `git diff --name-only drizzle/meta/` is empty |
| Dependencies unchanged | PASS | `git diff -- package.json package-lock.json` is empty |
| CI/config unchanged | PASS | `git diff -- .github/ playwright.config.ts next.config.ts tsconfig.json` is empty |
| Dependency vulnerabilities preserved as open finding | PASS | 19 advisories (1 critical, 9 high, 7 moderate, 2 low) recorded for remediation in Phase 1.5 |
