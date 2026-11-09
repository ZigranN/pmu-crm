# Google Calendar Integration & Reconciliation Policy

## 1. Executive Summary & Source of Truth Boundary

In the PMU CRM architecture, the CRM database is the **authoritative operational record of truth** for all clinical and business operations:
- **CRM Appointments** are authoritative for scheduling, assigned masters, client identity, services, and visit kinds.
- **TreatmentCycles**, medical profiles, contraindications, and signed consents are strictly guarded inside the CRM. External systems (such as Google Calendar) **never** modify clinical eligibility, consent records, financial ledgers, or procedure sessions directly.
- **Google Calendar** is an external synchronized representation designed to provide masters with calendar visibility on their personal or studio Google accounts.

---

## 2. Synchronization Boundaries & Guarantees

### 2.1 Outbound Synchronization (CRM -> Google Calendar)
When an appointment is created, rescheduled, or cancelled within the CRM:
1. **Transactional Outbox**: An outbox job (`google-calendar.sync-appointment.v1` or `google-calendar.delete-appointment.v1`) is enqueued atomically inside the database transaction of the appointment mutation.
2. **Idempotency**: Every outbox job uses unique `eventKey` and SHA-256 payload hashing. Google Event operations maintain an explicit hash (`lastSyncedHash`) of the appointment snapshot (time range, client name, service, master, status) to prevent redundant remote API calls.
3. **Tenant & Master Isolation**: Only Google Calendar connections belonging to the appointment's studio and (if configured) the specific master are synchronized.
4. **Retry & Error Recovery**: The transactional outbox worker automatically retries transient failures with exponential backoff. Permanent authentication errors update the connection status to `needs_reauth` or `sync_error` without aborting CRM domain commands.

### 2.2 Inbound Reconciliation Policy (Google Calendar -> CRM)
When Google Calendar events are modified externally:
1. **Time Shift / Rescheduling**:
   - The reconciliation engine checks if the proposed new time window respects master working hours and does not overlap with existing CRM appointments.
   - If available: The appointment is rescheduled through the CRM domain command with audit reason `command:google_calendar_reconcile`.
   - If conflict occurs or master is unavailable: The CRM appointment time is **preserved as authoritative**. A sync conflict status is flagged on the mapping record and recorded in the connection audit log.
2. **Remote Event Deletion / Cancellation**:
   - If a master deletes the event on Google Calendar, the CRM reconciles the event status. Depending on the connection policy, the CRM appointment is cancelled with reason `"Cancelled via Google Calendar"` or the mapping is detached without destroying clinical history.
3. **Immutable Clinical Invariants**:
   - Google Calendar reconciliation **CANNOT** alter TreatmentCycle stage, medical clearances, consent forms, payments, or completed procedure records.

---

## 3. Data Model & Encryption Security

- **Secrets Storage**: All Google OAuth access tokens and refresh tokens are encrypted at rest using authenticated **AES-256-GCM** with unique initialization vectors (`enc:v1:<iv>:<tag>:<ciphertext>`).
- **OAuth CSRF Defense**: The OAuth flow utilizes HMAC-SHA256 signed and timestamped state parameters to prevent cross-site request forgery and connection hijacking.
- **Audit Logging**: Every connection, disconnection, token refresh failure, and reconciliation batch is logged in the CRM immutable audit and access logs.
