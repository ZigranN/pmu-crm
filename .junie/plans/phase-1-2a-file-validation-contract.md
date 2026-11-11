---
sessionId: session-260919-214724-7l2s
---

# Requirements

### Overview & Goals
Define and formalize the authoritative server-side file-type validation, size limits, and Active Studio authorization contract across all PMU CRM file upload entry points prior to implementation in Phase 1.2B.

### Scope
- **In Scope**:
  - File upload use-case classification (`GENERIC_PROFILE_IMAGE`, `MASTER_PHOTO`, `STUDIO_LOGO`, `CLIENT_PMU_MEDIA`, `CONSENT_DOCUMENT`).
  - Authoritative magic-byte binary header validation (JPEG, PNG, WebP, PDF, HEIC/HEIF).
  - Domain-specific format allowlists and exact server-side size boundaries (5MB and 10MB).
  - Bounding Cloudinary `resource_type` to explicit `"image"` and `"raw"` types.
  - Complete elimination of SVG/active vector uploads to prevent Stored XSS.
  - Active Studio context resolution (`pmu_active_studio`) and tenant-namespacing for generic uploads.
  - Compensation rollback on database persistence failure.
- **Out of Scope**:
  - Private / signed delivery URLs and CDN cache policies (deferred to PHASE 1.3).
  - Medical clearance redesign or database schema modifications (0 migrations required).

### Functional Requirements & Invariants
- Browser-provided `file.type`, extensions, and multipart `Content-Type` headers are non-authoritative.
- Server validates file signature from first 64 bytes before streaming to Cloudinary.
- Any validation failure aborts execution with 0 provider calls and 0 database writes.
- Foreign tenant client/appointment/session references fail closed with zero external asset retention.

# Technical Design

### Current Implementation & Gap Analysis
- `/api/upload/image` only inspects `file.type.startsWith("image/")` (client-controlled) and lacks Active Studio scoping, uploading to shared `crm-pmu/general`.
- `withMediaUpload` enforces client lock and studio folder namespacing, but lacks an authoritative server-side size upper bound and magic-byte allowlist.
- `src/lib/cloudinary.ts` defaults to `resource_type: "auto"`.

### Target Architecture & Validations
- **Validation Pipeline**:
  ```text
  Browser Request
  → Authenticate & resolve Active Studio Context
  → Verify Permission & Relational Ownership
  → Inspect Magic Bytes (0..64) & Check File Size <= Limit
  → Stream to Cloudinary (Explicit resource_type)
  → DB Transaction (Insert records + Audit log)
  → (On Error) Delete from Cloudinary compensation rollback
  ```
- **Format Allowlists**:
  - Generic Images / Portraits / Logos: JPEG, PNG, WebP (Max 5MB).
  - Client PMU Media: JPEG, PNG, WebP, HEIC/HEIF (Max 10MB).
  - Consents: PDF (`resource_type: "raw"`), JPEG, PNG, WebP (`resource_type: "image"`) (Max 10MB).
- **SVG Policy**: Strictly prohibited across all endpoints.

### File Structure & Changes
- `src/lib/file-validation.ts`: New zero-dependency magic-byte header validation helper.
- `src/app/api/upload/image/route.ts`: Enforce Active Studio context, studio folder namespacing, and magic-byte checks.
- `src/lib/cloudinary.ts`: Require explicit `resource_type: "image" | "raw"`.
- `src/features/media/server/service.ts`: Enforce size and format bounds before Cloudinary upload.
- `src/features/consent/server/actions.ts`: Enforce size and format bounds before Cloudinary upload.

# Testing

### Validation Approach
Verify upload authorization, magic-byte inspection, size enforcement, and failure compensation using automated unit, integration, and regression suites.

### Key Scenarios
1. **Unauthenticated / Unscoped Uploads**:
   - Generic upload without auth $\rightarrow$ 401.
   - Generic upload without active studio cookie $\rightarrow$ 400/403.
   - Generic upload with valid studio $\rightarrow$ stored under `crm-pmu/${studioId}/general`.
2. **Authoritative Content Validation & MIME Spoofs**:
   - `photo.jpg` with text/HTML bytes $\rightarrow$ Rejected (0 Cloudinary calls).
   - `consent.pdf` with non-PDF bytes $\rightarrow$ Rejected (0 Cloudinary calls).
   - SVG upload attempt $\rightarrow$ Rejected (0 Cloudinary calls).
   - File exceeding 5MB / 10MB boundary $\rightarrow$ Rejected (0 Cloudinary calls).
3. **Multi-Tenant Ownership & Isolation**:
   - Studio A context targeting Client B $\rightarrow$ Rejects with "Client not found" (0 Cloudinary calls, 0 DB rows).
   - Foreign appointment/session IDs $\rightarrow$ Rejects before upload.
4. **Compensation Rollback**:
   - Mock DB failure after Cloudinary upload $\rightarrow$ Invokes `deleteFromCloudinary(publicId)`.

# Delivery Steps

### ✓ Step 1: Implement authoritative server-side file validator
- Implement authoritative buffer signature extraction and format verification in `src/lib/file-validation.ts`.
- Implement binary magic-number checks for JPEG, PNG, WebP, PDF, and HEIC/HEIF without external dependencies.
- Define explicit allowlists and exact byte size bounds (`GENERIC_MAX_BYTES = 5,242,880`, `MEDIA_MAX_BYTES = 10,485,760`, `CONSENT_MAX_BYTES = 10,485,760`).
- Ensure validation fails fast before any Cloudinary stream or DB transaction is initiated.

### ✓ Step 2: Harden generic image upload route and Cloudinary wrapper
- Update `src/app/api/upload/image/route.ts` to require active studio context via `requireBrowserStudioPermission` / `requireBrowserStudioContext`.
- Target studio-namespaced Cloudinary folder `crm-pmu/${studioId}/general`.
- Apply raster-only format allowlist (JPEG, PNG, WebP) and 5MB ceiling; explicitly block SVG and active vector formats.
- Update `src/lib/cloudinary.ts` to require explicit `resource_type: "image" | "raw"`.

### ✓ Step 3: Harden domain media and consent upload actions
- Update `src/features/media/server/service.ts` and `src/features/media/server/actions.ts` to validate magic bytes and enforce 10MB ceiling on procedure media before Cloudinary upload.
- Update `src/features/consent/server/actions.ts` and `src/features/consent/server/service.ts` to validate PDF / image signatures and 10MB ceiling on consent documents.
- Preserve compensation rollback (`deleteFromCloudinary`) if the subsequent database transaction fails.

### ✓ Step 4: Add comprehensive upload security and isolation test suite
- Add unit and integration tests covering unauthenticated, missing-cookie, and stale-cookie upload requests to `/api/upload/image`.
- Add MIME-spoof tests verifying non-image files disguised as JPEG/PNG and non-PDF files disguised as PDF are rejected before provider calls.
- Add cross-tenant rejection tests ensuring foreign client, appointment, and session IDs abort immediately without provider upload or DB write.
- Add provider compensation rollback tests verifying asset deletion when DB persistence fails.