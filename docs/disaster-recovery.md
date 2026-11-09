# Disaster Recovery & Operations Runbook

## 1. Overview & Recovery Scope

This runbook establishes operational procedures, recovery targets, and technical workflows for disaster recovery (DR) and business continuity across the PMU CRM platform.

### Authoritative State (Must be Restored)
1. **PostgreSQL Database**: Relational schema, tenants (studios), clients, medical revisions, clearances, treatment cycles, appointments, procedure sessions, financial payments/transactions, conversations, outbox jobs, Google Calendar sync mappings, AI run history, privacy/GDPR requests, and audit logs.
2. **Signed Consent Evidence**: Digitally signed client consent documents (`cycle_consents.signed_pdf_sha256`) and associated PDF media files.
3. **Clinical & Procedure Evidence**: Before/after procedure photographs and procedure session documentation.
4. **Financial Ledger History**: Completed payments, packages, and transaction audit trails.
5. **Encryption Keys**: Symmetric encryption secrets used for securing OAuth refresh and access tokens.

### Re-creatable State (Transient / Derived)
1. **Temporary Uploads**: Unattached client uploads within temporary grace period (7 days).
2. **Privacy Export Artifacts**: Generated zip/json download archives for GDPR DSAR requests (re-creatable from audit trail within retention period).
3. **Application Cache & Session State**: Transient server-side cache and expired user sessions.
4. **Derived Analytics**: Rollup read models rebuildable from canonical ledger and session tables.

---

## 2. Recovery Objectives (RPO & RTO)

These operational targets balance business continuity and infrastructure cost:

| Resource | Target RPO | Target RTO | Backup Cadence | Method |
| :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL Database** | $\le 1\text{ hour}$ | $\le 1\text{ hour}$ | Hourly logical/WAL snapshots; daily full dump | `pg_dump -Fc` with SHA-256 verification |
| **Signed Consent PDFs** | $\le 1\text{ hour}$ | $\le 2\text{ hours}$ | Continuous object sync / daily manifest | Storage replication + SHA-256 manifest |
| **Clinical Procedure Media** | $\le 1\text{ hour}$ | $\le 2\text{ hours}$ | Continuous object sync / daily manifest | Storage replication + SHA-256 manifest |
| **App / Worker Services** | $0$ (Stateless) | $\le 15\text{ mins}$ | Git tags / immutable image builds | Container redeployment |
| **Integration Config / Secrets**| $0$ | $\le 30\text{ mins}$ | Secret manager versioning / offline vault | Secret vault recovery |

---

## 3. Incident Severity Model & Recovery Ownership

### Severity Levels
- **SEV1 (Critical)**: Primary database unavailable, data corruption in authoritative ledger or signed consent evidence, core client treatment records inaccessible.
- **SEV2 (Major)**: Background worker halted, outbox processing backlog accumulating, private media storage read degraded. Core CRM read/write remains active.
- **SEV3 (Minor)**: External optional integration degraded (Google Calendar sync error, third-party AI provider outage). CRM operations continue unaffected.

### Role Ownership Matrix
| Action | Permitted Roles | Notes |
| :--- | :--- | :--- |
| **PostgreSQL Backup** | Infrastructure Admin / Ops Automation | Automated cron / manual pre-deployment |
| **PostgreSQL Restore** | Infrastructure Admin | Requires explicit `--confirm` and `--force-production-restore` |
| **Media Manifest / Sync**| Infrastructure Admin / Ops Automation | Read-only against storage & database |
| **Key Rotation** | Security Officer / Lead Infra | Requires synchronized secret deployment |
| **Job Retry / Dead Queue**| Studio Owner / Tech Admin | Operator-driven outbox remediation |
| **Google Reconnect** | Studio Master / Owner | Self-service OAuth reauthorization via Settings |

---

## 4. Production Secret & Configuration Inventory

Exact repository environment variable names required for cold-start recovery:

| Variable Name | Required | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | Yes | PostgreSQL connection string with credentials |
| `BETTER_AUTH_SECRET` | Yes | Session signing secret and default encryption fallback |
| `BETTER_AUTH_URL` | Yes | Public application URL for authentication redirects |
| `NEXT_PUBLIC_APP_URL` | Yes | Client-facing base URL |
| `ENCRYPTION_KEY` | Recommended | Dedicated AES-256-GCM master key for OAuth secrets |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | Optional | Dedicated encryption key for Google tokens |
| `CLOUDINARY_CLOUD_NAME` | Yes | Private media authenticated asset storage |
| `CLOUDINARY_API_KEY` | Yes | Media storage provider API key |
| `CLOUDINARY_API_SECRET` | Yes | Media storage provider API secret |
| `WORKER_SECRET` | Optional | Secret token for scheduled worker trigger endpoint |

*Never commit actual secret values into version control.*

---

## 5. Standard Operating Procedures (SOP)

### SOP-01: Logical Database Backup
```bash
# Execute standard logical backup (creates compressed .dump and .sha256 checksum)
npm run ops:backup:pg

# Or specify custom destination
node scripts/backup-postgres.mjs --database-url "$DATABASE_URL" --output "./backups/postgres/prod-backup-$(date +%s).dump"
```

### SOP-02: Clean Database Restoration
```bash
# Mandatory: specify backup file and explicit confirmation flag
node scripts/restore-postgres.mjs \
  --backup-file "./backups/postgres/pmu-backup-timestamp.dump" \
  --target-url "$TARGET_DATABASE_URL" \
  --confirm

# If restoring to a remote production URL, also pass --force-production-restore:
node scripts/restore-postgres.mjs \
  --backup-file "./backups/postgres/pmu-backup-timestamp.dump" \
  --target-url "$PRODUCTION_DATABASE_URL" \
  --confirm \
  --force-production-restore
```

### SOP-03: Media Manifest Backup & Verification
```bash
# Generate manifest and copy files
npm run ops:backup:media

# Verify manifest and restored media against target database
node scripts/restore-media.mjs \
  --manifest "./backups/media/media-manifest.json" \
  --files-dir "./backups/media/files" \
  --database-url "$DATABASE_URL" \
  --confirm
```

---

## 6. Disaster Scenarios & Recovery Procedures

### Scenario A: PostgreSQL Database Loss / Corruption
- **Symptoms**: Database connection errors (503 on `/api/health?mode=readiness`), data corruption alerts.
- **Impact**: SEV1 — Core CRM unavailable.
- **Immediate Action**:
  1. Freeze application traffic (point DNS / load balancer to maintenance page).
  2. Provision a clean PostgreSQL 17 instance.
  3. Locate latest verified `.dump` file and verify its `.sha256` checksum.
- **Restore Procedure**:
  1. Run `node scripts/restore-postgres.mjs --backup-file <dump> --target-url <new_url> --confirm`.
  2. Run migration verifier: `node --test tests/phase02-pg-verify.mjs`.
  3. Validate database health endpoint: `curl -s http://localhost:3000/api/health?mode=readiness`.
- **Validation**:
  1. Confirm studio accounts, clients, treatment cycles, and ledger transactions are visible.
  2. Verify signed consent hash references match stored files.
  3. Start application and remove maintenance mode.

### Scenario B: Application / Container Instance Loss
- **Symptoms**: HTTP 502 Bad Gateway or connection refused.
- **Impact**: SEV1 (if all instances down) / SEV2 (if partial instance pool down).
- **Immediate Action**:
  1. Trigger container orchestrator restart / redeploy from container registry using verified commit SHA.
  2. Check environment variables match the configuration inventory.
  3. Verify health endpoint (`/api/health?mode=liveness`).

### Scenario C: Outbox Worker Crash & In-Flight Job Recovery
- **Symptoms**: Worker process crashes while processing jobs; jobs remain in `processing` state.
- **Impact**: SEV2 — Delayed notifications or external sync.
- **Recovery Behavior**:
  1. Outbox jobs utilize leased row locks with `lease_until` timestamps.
  2. When a worker dies, its lease expires automatically.
  3. Upon next worker cycle (`runWorkerOnce`), expired leases are safely reclaimed:
     - Transactional jobs revert to `pending` and re-execute safely inside database transactions.
     - External jobs transition to `uncertain` and execute reconciliation handlers before retry.
  4. Dead jobs (`attempts >= max_attempts`) remain `dead` and require operator investigation.

### Scenario D: Media Storage Loss
- **Symptoms**: Media download returns 404 on `/api/media/[id]/content`.
- **Impact**: SEV2 — Inability to view photos/consent PDFs; business operations can continue.
- **Immediate Action**:
  1. Restore media files from storage backup into new bucket/folder.
  2. Execute `node scripts/restore-media.mjs --manifest <manifest.json> --database-url <db_url> --confirm`.
  3. Verify SHA-256 hashes of restored files match `cycle_consents.signed_pdf_sha256`.

### Scenario E: Permanent Encryption Key Loss
- **Symptoms**: Decryption errors for Google Calendar tokens (`Invalid encrypted payload format` or tag verification failure).
- **Impact**: SEV2/3 — Google Calendar sync fails with `needs_reauth`. Core CRM data remains 100% intact.
- **Recovery Procedure**:
  1. Core CRM data does **not** rely on reversible encryption for primary records; only third-party OAuth tokens use `enc:v1:`.
  2. Deploy a newly generated `ENCRYPTION_KEY` in environment variables.
  3. Notify affected studio masters to re-authenticate Google Calendar via Settings.

### Scenario F: External Provider Outages (Google Calendar / AI Provider)
- **Symptoms**: Degraded status reported on `/api/health`.
- **Impact**: SEV3 — Core booking, client records, and medical charts remain fully functional.
- **Recovery Procedure**:
  1. The CRM architecture isolates external integration failures.
  2. Google Calendar sync jobs fail safely and log structured error codes.
  3. AI assistants fail gracefully without blocking consultations or clinical charting.

---

## 7. Backup Security & Retention Policy

### Backup Security at Rest
1. PostgreSQL logical backups contain sensitive medical notes, client PII, and financial ledgers.
2. Production backup files must be encrypted with AES-256 before upload to off-site cloud storage.
3. Access to backup artifacts is restricted to authorized infrastructure administrators.

### Backup Retention Schedule
- **Daily Backups**: Retained for 30 days.
- **Weekly Backups**: Retained for 12 weeks.
- **Monthly Backups**: Retained for 12 months.
- *Note*: Backup retention is separate from GDPR client retention policies (`studio_privacy_retention_policies`).
