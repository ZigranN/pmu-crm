# Phase 1.1A — Explicit Active Studio Context: Contract & Impact Map

---

## 1. Problem & Executive Summary

The PMU CRM application is a multi-tenant platform where a user may hold memberships across multiple independent Studios. The canonical multi-tenant business rule requires that **every studio-scoped domain operation must execute against an explicit, authenticated, and verified active Studio context**.

### Identified Vulnerability / Architectural Defect
The legacy codebase in `src/server/auth/context.ts` implemented an implicit fallback mechanism within `getCurrentStudioId(userId)` and `resolveStudio(explicitStudioId?)`:
```ts
// LEGACY IMPLICIT FALLBACK DEFECT
const membership = await db.query.studioMembers.findFirst({
  where: and(eq(studioMembers.userId, userId), eq(studioMembers.isActive, true)),
});
return membership?.studioId; // "First active row wins"
```

If no explicit Studio was supplied (or if an operation was invoked in an ambiguous browser context), the system silently selected the first active Studio membership. This created severe multi-tenant risks:
1. **Ambiguous Multi-Studio Operations**: A user belonging to multiple studios could execute operations against an arbitrary studio without explicit consent.
2. **Silent Cross-Tenant Data Access**: Domain reads or mutations on pages without explicit parameters defaulted to whichever studio membership was returned first by PostgreSQL.
3. **Stale / Revoked Context Fallback**: If a user's membership in one studio was revoked, requests could silently fall through to another studio rather than failing closed.

This specification details the elimination of all implicit studio fallbacks and defines the canonical server context contract, untrusted cookie transport, explicit bootstrap/switcher lifecycles, error taxonomy, and complete call-site migration plan.

---

## 2. Current Resolution Architecture

In the current codebase, session authentication and studio resolution occur through several disconnected pathways:

1. **Authentication Session**:
   - Resolved via Better Auth session cookies (`auth_session`).
   - Retrieved in server components and actions via `getSession()` in `src/lib/auth-client.ts` / Better Auth server integration.
2. **Studio Membership & Authorization**:
   - `src/server/auth/context.ts` defines `getCurrentStudioId(userId)`, `requireStudioContext()`, and `requireStudioPermission(permission)`.
   - `src/server/auth/scopes.ts` defines `sensitiveRead(session, studioId, scope)` and `withStudioCommand(...)`.
3. **Downstream Consumption**:
   - Dashboard layouts, server components, and server actions invoke `getCurrentStudioId(session.user.id)` or `requireStudioPermission(permission)` without passing an explicit Studio ID.
   - Internal background jobs execute via `src/server/events/outbox.ts` and `src/app/api/internal/jobs/route.ts` using job-persisted `job.studioId`.

---

## 3. First-Active Fallback Locations

The exact source locations where implicit fallback is implemented:

1. `src/server/auth/context.ts` in `getCurrentStudioId(userId: string)`:
   - Queries `studioMembers` for the first record matching `userId` and `isActive = true`.
2. `src/server/auth/context.ts` in `resolveStudio(explicitStudioId?: string)`:
   - If `explicitStudioId` is undefined, falls back to `getCurrentStudioId(session.user.id)`.
3. `src/server/auth/scopes.ts` in `sensitiveRead(session, studioId, scope)`:
   - If `studioId` is omitted (`undefined`), calls `getCurrentStudioId(session.user.id)`.

All of these fallback branches will be eliminated in Phase 1.1B.

---

## 4. Call-Site Inventory

Every usage of the legacy studio resolution helpers across the repository has been audited:

| File | Function / Component | Current Context Source | Studio-Scoped? | Mutation / Read | Risk | Migration Plan (Phase 1.1C) |
| --- | --- | --- | --- | --- | --- | --- |
| `src/app/(dashboard)/layout.tsx` | `DashboardLayout` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` & Bootstrap |
| `src/app/(dashboard)/dashboard/page.tsx` | `DashboardPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/page.tsx` | `ClientsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/new/page.tsx` | `NewClientPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/[id]/page.tsx` | `ClientDetailPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Critical | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/[id]/edit/page.tsx` | `EditClientPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/[id]/merge/page.tsx` | `ClientMergePage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Critical | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/clients/[id]/offers/page.tsx` | `ClientOffersPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/deals/page.tsx` | `DealsPage` | `getCycleBoard()` (implicit `sensitiveRead`) | Yes | Read | High | Pass explicit studio context from `requireBrowserStudioContext` |
| `src/app/(dashboard)/deals/[id]/page.tsx` | `DealDetailPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/masters/page.tsx` | `MastersPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/masters/new/page.tsx` | `NewMasterPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/masters/[id]/page.tsx` | `MasterDetailPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/masters/[id]/edit/page.tsx` | `EditMasterPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/masters/[id]/schedule/page.tsx` | `MasterSchedulePage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/services/page.tsx` | `ServicesPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/services/new/page.tsx` | `NewServicePage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/services/[id]/page.tsx` | `ServiceDetailPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/services/[id]/edit/page.tsx` | `EditServicePage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/services/[id]/pricing/page.tsx` | `ServicePricingPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/page.tsx` | `SettingsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Medium | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/studio/page.tsx` | `StudioSettingsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/team/page.tsx` | `TeamSettingsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Critical | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/audit/page.tsx` | `AuditSettingsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | Critical | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/jobs/page.tsx` | `JobsSettingsPage` | `getCurrentStudioId(session.user.id)` | Yes | Read | High | Refactor to `requireBrowserStudioContext` |
| `src/app/(dashboard)/settings/cycle-migration/page.tsx` | `CycleMigrationPage` | `getLegacyCycleReport()` (implicit `sensitiveRead`) | Yes | Read | High | Pass explicit studio context from `requireBrowserStudioContext` |
| `src/features/clients/server/actions.ts` | `createClientAction` | `requireStudioPermission("CLIENT_CREATE")` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/clients/server/actions.ts` | `updateClientAction` | `requireStudioPermission("CLIENT_UPDATE")` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/clients/server/actions.ts` | `archiveClientAction` / `restoreClientAction` | `requireStudioPermission(...)` | Yes | Mutation | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/clients/server/administration.ts` | `setPreferredMaster`, `setClientAdministrativeQualification` | `requireStudioContext()` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioContext` |
| `src/features/clients/server/duplicate-actions.ts` | `reviewClientDuplicates` | `sensitiveRead(..., undefined)` | Yes | Read | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/clients/server/medical-actions.ts` | `updateMedicalAction` | `requireStudioPermission("MEDICAL_PROFILE_UPDATE")` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/clients/server/merge-actions.ts` | `previewClientMerge`, `executeClientMergeAction`, `getClientMergeHistory`, `getMergeCandidates` | `sensitiveRead(..., undefined)`, `requireStudioPermission(...)` | Yes | Read/Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/commercial-terms/server/actions.ts` | `saveCycleTermsAction` | `requireStudioPermission("OFFER_MANAGE")` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/consent/server/actions.ts` | `uploadConsentAction`, `getClientConsentsAction`, `deleteConsentAction` | `getCurrentStudioId(session.user.id)` | Yes | Mutation/Read | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/consultations/server/results.ts` | `recordConsultationResultAction` | `requireStudioPermission("CLIENT_UPDATE")` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/jobs/server/actions.ts` | `triggerWorkerRun` | `requireStudioPermission("STUDIO_MANAGE")` | Yes | Mutation | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/masters/server/actions.ts` | `createMasterAction`, `updateMasterAction`, `archiveMasterAction`, `saveMasterScheduleAction` | `requireStudioPermission(...)` | Yes | Mutation | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/media/server/actions.ts` | `uploadMediaAction`, `deleteMediaAction`, `getClientMediaAction` | `getCurrentStudioId(session.user.id)`, `requireStudioPermission(...)` | Yes | Mutation/Read | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/offers/server/actions.ts` | `createCustomOfferAction`, `createOfferRevisionAction`, `acceptOfferAction` | `requireStudioPermission(...)` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/services/server/actions.ts` | `createServiceAction`, `updateServiceAction`, `archiveServiceAction`, `importPhase3Catalog`, `reconcileDuplicatesAction` | `withStudioCommand(...)` | Yes | Mutation | High | Refactor `withStudioCommand` to use `requireBrowserStudioPermission` |
| `src/features/settings/server/actions.ts` | `updateStudioSettingsAction` | `withStudioCommand(...)` | Yes | Mutation | High | Refactor `withStudioCommand` to use `requireBrowserStudioPermission` |
| `src/features/settings/server/role-management.ts` | `saveMembership`, `assignClientMaster` | `requireStudioContext()` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioContext` |
| `src/features/treatment-cycles/server/actions.ts` | `recordCycleStageAction`, `inspectCycleAction`, `closeCycleAction` | `requireStudioPermission(...)` | Yes | Mutation | Critical | Resolve via `requireBrowserStudioPermission` |
| `src/features/treatment-cycles/server/reschedule-followup.ts` | `rescheduleFollowUpAction` | `requireStudioPermission("CLIENT_UPDATE")` | Yes | Mutation | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/treatment-cycles/server/review.ts` | `recordCycleReviewAction` | `requireStudioPermission("CLIENT_UPDATE")` | Yes | Mutation | High | Resolve via `requireBrowserStudioPermission` |
| `src/features/search/server/actions.ts` | `globalSearch` | Explicit `studioId` param -> `sensitiveRead(..., studioId)` | Yes | Read | Medium | Validate via `requireStudioPermissionFor` |
| `src/app/api/media/upload/route.ts` | `POST` | Calls `uploadMediaAction(formData)` | Yes | Mutation | Critical | Enforce `requireBrowserStudioPermission` |
| `src/app/api/upload/image/route.ts` | `POST` | Only checks `getSession()` without studio | No (General) | Mutation | Critical | Bring under studio scoping in Phase 1.3 |
| `src/app/api/internal/jobs/route.ts` | `POST` | Secret-authenticated, job records carry `studioId` | Yes | Mutation | Low (Safe) | Retain trusted payload contract |

---

## 5. Entry Point Classification

### A. Server Components / Pages (Browser Navigation)
- **Mechanism**: Invokes `requireBrowserStudioContext()` which inspects the `pmu_active_studio` HttpOnly cookie.
- **Handling Missing Context (`STUDIO_CONTEXT_REQUIRED`)**:
  - User with zero active memberships: Renders safe no-studio status banner without querying tenant data.
  - User with exactly one active membership & missing cookie: Renders bootstrap client component to establish the context via Server Action.
  - User with multiple active memberships & missing cookie: Renders Studio Selector view/modal.
- **Handling Stale/Invalid Context (`STUDIO_CONTEXT_STALE`)**:
  - Renders safe stale-context state prompting re-selection or clearing stale context via Server Action mutation boundary. Zero tenant data rendered.

### B. Server Actions (Browser Mutations)
- **Mechanism**: Invokes `requireBrowserStudioPermission(permission)`. Extracts the requested studio ID exclusively from the `pmu_active_studio` cookie.
- **Handling Missing / Stale Context**: Fails immediately with `STUDIO_CONTEXT_REQUIRED` or `STUDIO_CONTEXT_STALE`. Never falls back to a default studio.

### C. Explicit API Endpoints & Trusted External Callers
- **Mechanism**: Dedicated API routes or integration callers that accept an explicit `studioId` parameter must invoke `requireStudioContextFor(userId, requestedStudioId)` or `requireStudioPermissionFor(userId, studioId, permission)`.
- **Rule**: Explicit `studioId` input is strictly an untrusted request hint; the server validates membership and studio activity via `requireActiveStudioMembership`. Arbitrary request headers are NOT allowed to override browser resolution.

### D. Command Handlers & Idempotency Pipeline
- **Mechanism**: `idempotentCommand` and `lockStudioAccess` receive a strictly validated `context: StudioContext` from the calling action.
- **Rule**: Commands do not resolve studio context independently; they consume verified context.

### E. Internal Worker / Outbox Handlers
- **Mechanism**: `outboxJobs` table stores immutable `studioId` in each job row. `runWorkerOnce` passes `job.studioId` directly to registered event handlers (`handlers[job.handler].run(tx, job)`).
- **Rule**: Workers are trusted background processes; they never read browser cookies, HTTP headers, or invoke browser session resolution.

### F. Media & Upload Endpoints
- **Mechanism**: `/api/media/upload` operates in browser context via `requireBrowserStudioPermission("MEDIA_CREATE" | "CONSENT_UPLOAD")`.

### G. E2E & Test Utilities
- **Mechanism**: Integration tests mock cookies with explicit studio ID; E2E tests establish the `pmu_active_studio` cookie or execute studio selection via UI.

---

## 6. Canonical Context Contract & API Design

### A. Data Types & Cookie State Model

```ts
import { PermissionCode } from "@/lib/permissions";
import { StudioRole } from "@/lib/roles";

export const ACTIVE_STUDIO_COOKIE = "pmu_active_studio";

export type ActiveStudioCookieState =
  | { kind: "missing" }
  | { kind: "valid"; studioId: string }
  | { kind: "invalid" };

export interface StudioContext {
  userId: string;
  userEmail: string;
  studioId: string;
  membershipId: string;
  role: StudioRole | string;
  studioName: string;
  studioSlug?: string;
}
```

### B. Canonical Context Functions

```ts
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { studioMembers, studios } from "@/db/schema";
import { getSession } from "@/lib/auth-client";
import { StudioRole } from "@/lib/roles";
import { hasPermission, PermissionCode } from "@/lib/permissions";
import { z } from "zod";

/**
 * 1. Authenticate Session User
 */
export async function requireAuthenticatedUser() {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("AUTH_REQUIRED");
  }
  return session.user;
}

/**
 * 2. Inspect Untrusted Browser Cookie State
 * Preserves three distinct states: MISSING, VALID, INVALID
 */
export async function readActiveStudioCookieState(): Promise<ActiveStudioCookieState> {
  const cookieJar = await cookies();
  const cookieValue = cookieJar.get(ACTIVE_STUDIO_COOKIE)?.value;

  if (!cookieValue) {
    return { kind: "missing" };
  }

  if (!z.string().uuid().safeParse(cookieValue).success) {
    return { kind: "invalid" };
  }

  return { kind: "valid", studioId: cookieValue };
}

/**
 * 3. Authoritative Studio Membership Validation (Single Core Validator)
 * Verifies valid studio UUID, active membership, and active studio.
 * Studio context proves tenant membership ONLY; it does NOT decide final capability authorization.
 */
export async function requireActiveStudioMembership(
  userId: string,
  studioId: string
): Promise<StudioContext> {
  if (!z.string().uuid().safeParse(studioId).success) {
    throw new Error("STUDIO_ACCESS_DENIED");
  }

  const membership = await db.query.studioMembers.findFirst({
    where: and(
      eq(studioMembers.userId, userId),
      eq(studioMembers.studioId, studioId),
      eq(studioMembers.isActive, true)
    ),
    with: {
      studio: true,
    },
  });

  if (!membership || !membership.studio || !membership.studio.isActive) {
    throw new Error("STUDIO_ACCESS_DENIED");
  }

  const role = membership.role as StudioRole;

  return {
    userId,
    userEmail: "", // populated from authenticated session
    studioId: membership.studioId,
    membershipId: membership.id,
    role,
    studioName: membership.studio.name,
    studioSlug: membership.studio.slug || undefined,
  };
}

/**
 * 4. Browser Context Resolution (for Pages, Layouts, Browser Actions)
 */
export async function requireBrowserStudioContext(): Promise<StudioContext> {
  const user = await requireAuthenticatedUser();
  const cookieState = await readActiveStudioCookieState();

  if (cookieState.kind === "missing") {
    throw new Error("STUDIO_CONTEXT_REQUIRED");
  }

  if (cookieState.kind === "invalid") {
    throw new Error("STUDIO_CONTEXT_STALE");
  }

  try {
    const context = await requireActiveStudioMembership(user.id, cookieState.studioId);
    context.userEmail = user.email || "";
    return context;
  } catch (error) {
    // A valid UUID in the cookie that is not active/valid for this user is STALE persisted browser context
    throw new Error("STUDIO_CONTEXT_STALE");
  }
}

/**
 * 5. Browser Permission Check (for Server Actions)
 * Uses canonical hasPermission engine to preserve role capabilities and custom deny/allow overrides.
 */
export async function requireBrowserStudioPermission(
  permission: PermissionCode
): Promise<StudioContext> {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, permission);
  if (!allowed) {
    throw new Error("FORBIDDEN_PERMISSION");
  }
  return context;
}

/**
 * 6. Explicit Context Resolution (for APIs/Integrations with explicit studioId)
 */
export async function requireStudioContextFor(
  userId: string,
  requestedStudioId: string
): Promise<StudioContext> {
  return requireActiveStudioMembership(userId, requestedStudioId);
}

/**
 * 7. Explicit Permission Resolution (for APIs/Integrations)
 * Uses canonical hasPermission engine to preserve role capabilities and custom deny/allow overrides.
 */
export async function requireStudioPermissionFor(
  userId: string,
  studioId: string,
  permission: PermissionCode
): Promise<StudioContext> {
  const context = await requireStudioContextFor(userId, studioId);
  const allowed = await hasPermission(db, context.userId, context.studioId, permission);
  if (!allowed) {
    throw new Error("FORBIDDEN_PERMISSION");
  }
  return context;
}
```

### C. Separation of Membership and Capability Authorization

Active Studio Context refactoring strictly separates tenant membership validation from capability authorization:
1. **Tenant Membership (`requireActiveStudioMembership`)**: Establishes that the user belongs to the active Studio and provides identity metadata (`userId`, `studioId`, `membershipId`, `role`, `studioName`). It **never** embeds a static permissions array or evaluates capabilities.
2. **Authoritative Permission Evaluation (`hasPermission`)**: Evaluates permissions via the canonical engine (`src/lib/permissions.ts`), which dynamically enforces:
   - System role capabilities ceiling (`ROLE_CAPABILITIES`);
   - Explicit per-user custom overrides (`userCustomPermissions`) where **explicit deny overrides allow**;
   - Role-assigned permissions (`rolePermissions`).
3. **No Static Role Lookup Bypass**: Static role permissions (`ROLE_PERMISSIONS`) must NEVER be used for authoritative access control decisions. A Studio membership or role alone never proves a requested capability. Per-user overrides remain authoritative across all operations.

---

## 7. Context Transport Decision

### Canonical Transport: `pmu_active_studio` Cookie
- **Name**: `pmu_active_studio`
- **Value**: Studio UUID string only (e.g. `123e4567-e89b-12d3-a456-426614174000`).
- **HttpOnly**: `true` (Client-side JavaScript cannot read or tamper with the cookie; active studio metadata is delivered to the UI via server-rendered properties).
- **Secure**: `true` in production (`process.env.NODE_ENV === "production"`), `false` in local development/test environments.
- **SameSite**: `Lax` (Provides defense-in-depth against cross-site request forgery during top-level navigations).
- **Path**: `/`
- **Max-Age**: 30 days (`2,592,000` seconds).
- **Security Rule**: The cookie value is treated strictly as an **untrusted request hint**. The server independently verifies session authentication and active studio membership on every request.

### Removal of Generic Header Fallback
Generic request headers such as `x-studio-id` are explicitly excluded from the browser resolution hierarchy. Browser traffic relies exclusively on `pmu_active_studio`. APIs with explicit studio requirements must accept explicit parameters and use `requireStudioContextFor`.

---

## 8. Single-Studio Bootstrap Flow

To provide a seamless user experience without violating server security invariants, the system strictly separates **bootstrap convenience selection** from **authorization-time fallback**:

1. **Server Component Inspection**:
   - `DashboardLayout` executes `getSession()` and queries the user's active memberships from `studioMembers`.
2. **Zero Active Memberships**:
   - Layout renders a safe "No Active Studio" status page. No tenant queries are executed.
3. **Exactly One Active Membership & Valid Matching Cookie**:
   - `requireBrowserStudioContext()` validates the cookie and normal server rendering proceeds.
4. **Exactly One Active Membership & Missing / Mismatched Cookie**:
   - Domain queries strictly fail closed (no implicit fallback).
   - `DashboardLayout` renders `<SingleStudioBootstrap studioId={onlyMembership.studioId} />`.
   - The bootstrap component executes `useEffect` to call `setActiveStudioAction(onlyMembership.studioId)` via Server Action.
   - The Server Action validates membership on the server, sets the `HttpOnly` cookie, and triggers `router.refresh()`.
   - The page re-renders with valid context established.

---

## 9. Multi-Studio UX Contract & Studio Switcher

### A. Studio Switcher UI
- Displayed in `AppHeader` when `userMemberships.length > 1`.
- Renders the currently active studio name and a dropdown list of the user's active studio memberships.

### B. Switch Mutation Lifecycle (`setActiveStudioAction`)
```ts
export async function setActiveStudioAction(studioId: string) {
  const user = await requireAuthenticatedUser();
  const context = await requireActiveStudioMembership(user.id, studioId);

  const cookieJar = await cookies();
  cookieJar.set(ACTIVE_STUDIO_COOKIE, context.studioId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  revalidatePath("/", "layout");
  return { success: true, studioId: context.studioId, studioName: context.studioName };
}
```

### C. Safe Stale-Cookie Recovery Flow
Server Components cannot directly mutate cookies during render. Therefore, recovery from stale or invalid cookies must follow an explicit mutation boundary flow:

```text
Dashboard Layout detects STUDIO_CONTEXT_STALE
  │
  ├── User has 0 active memberships:
  │     Layout renders safe "No Active Studio" banner with <ClearStaleStudioActionRunner />
  │     Client calls clearActiveStudioAction() -> Server Action removes HttpOnly cookie -> UI refreshes cleanly
  │
  ├── User has 1 active membership:
  │     Layout renders <SingleStudioBootstrap studioId={onlyMembership.studioId} />
  │     Client calls setActiveStudioAction(onlyMembership.studioId) -> Server Action sets valid cookie -> UI refreshes
  │
  └── User has >1 active memberships:
        Layout renders <StudioSelectorModal memberships={userMemberships} isStaleNotice={true} />
        User selects studio -> Client calls setActiveStudioAction(selectedId) -> Server Action sets valid cookie -> UI refreshes
```

```ts
export async function clearActiveStudioAction() {
  await requireAuthenticatedUser();
  const cookieJar = await cookies();
  cookieJar.delete(ACTIVE_STUDIO_COOKIE);
  revalidatePath("/", "layout");
  return { success: true };
}
```

---

## 10. Canonical Error Contract

| Situation | Canonical Error Code | Layer / Surface | Response / UI Semantics | User-Facing Display | Security Invariant |
| --- | --- | --- | --- | --- | --- |
| Unauthenticated request | `AUTH_REQUIRED` | Page / Action / API | 401 / Redirect `/login` | "Требуется авторизация" | Zero session data exposed. |
| No browser active-Studio cookie | `STUDIO_CONTEXT_REQUIRED` | Page / Layout | Renders Studio Selector / Bootstrap | "Выберите активную студию" | Zero tenant data queried. |
| No browser active-Studio cookie | `STUDIO_CONTEXT_REQUIRED` | Server Action / API | 400 Bad Request / Error Object | "Не указана активная студия" | Rejects mutation without modifying DB. |
| Malformed persisted cookie | `STUDIO_CONTEXT_STALE` | Page / Layout | Renders safe recovery flow | "Сессия студии недействительна. Выберите студию повторно" | Does not treat as normal missing context; forces re-selection. |
| Revoked membership for persisted cookie | `STUDIO_CONTEXT_STALE` | Page / Layout / Action | 403 Forbidden / Error Object | "Сессия студии устарела. Выберите студию повторно" | Fails closed; prompts re-selection without leaking internal reasons. |
| Inactive Studio for persisted cookie | `STUDIO_CONTEXT_STALE` | Page / Layout / Action | 403 Forbidden / Error Object | "Сессия студии устарела. Выберите студию повторно" | Fails closed; collapsed to prevent leaking studio lifecycle state. |
| Foreign explicit Studio argument | `STUDIO_ACCESS_DENIED` | Action / API | 403 Forbidden / Error Object | "Доступ к студии запрещен" | Does not leak whether foreign studio exists. |
| Insufficient role / custom permissions | `FORBIDDEN_PERMISSION` | Action / API | 403 Forbidden / Error Object | "Недостаточно прав для выполнения операции" | Blocks operation within valid studio when canonical hasPermission evaluation fails. |

---

## 11. Command & Worker Contract

### A. Shared Domain Commands (`withStudioCommand`)
All domain commands (`idempotentCommand`, `lockStudioAccess`) must receive a verified `StudioContext` from the invoking server action:
```ts
export async function withStudioCommand<T>(
  permission: PermissionCode,
  fn: (ctx: StudioContext) => Promise<T>
): Promise<T> {
  const ctx = await requireBrowserStudioPermission(permission);
  return fn(ctx);
}
```

### B. Outbox Workers & Internal Background Jobs
- Worker jobs store `studioId` directly in the database row (`outboxJobs.studioId`).
- Worker execution derives tenant scope exclusively from the trusted job record.
- Background jobs **never** read browser cookies or HTTP headers.

---

## 12. Upload & Media Impact

1. `/api/media/upload`:
   - Operates within browser context.
   - Refactored in Phase 1.1C to invoke `requireBrowserStudioPermission("MEDIA_CREATE")`.
2. `/api/upload/image`:
   - Currently only checks `getSession()`.
   - Identified as a security gap in Phase 0.1 audit; will be brought under explicit studio scoping in Phase 1.3.

---

## 13. Cache & Data Isolation

### Core Security Invariant
**No tenant-derived cache/state may survive a Studio switch in a way that allows data from the previous Studio to be rendered under the new context.**

### Implementation Protections
1. **Server Rendering Isolation**: Next.js Server Components dynamically fetch tenant data on each request using the server-validated `context.studioId`.
2. **Navigation & Refresh**: `setActiveStudioAction` invokes `revalidatePath('/', 'layout')` to purge cached layout trees and re-render with the new context.
3. **No Unsafe Global Caching**: Audit confirms zero usage of `unstable_cache`, global domain singletons, or untagged shared memory caches.
4. **Client State Hygiene**: Any client components maintaining local state (e.g. form drafts, local search filters) must reset state upon studio change.

---

## 14. Test Impact Matrix

| Scenario | Test Layer | Target Test File | Expected Behavior |
| --- | --- | --- | --- |
| 1. Unauthenticated request | Unit / Integration | `tests/integration/studio-context.test.ts` | Throws `AUTH_REQUIRED` |
| 2. User with 0 active memberships | Integration / E2E | `tests/integration/studio-context.test.ts` | Throws `STUDIO_CONTEXT_REQUIRED`, UI renders safe banner |
| 3. Single active membership + missing cookie | Integration / E2E | `tests/e2e/studio-switcher.spec.ts` | Resolver throws `STUDIO_CONTEXT_REQUIRED`, bootstrap establishes cookie |
| 4. Multiple active memberships + missing cookie | Integration / E2E | `tests/e2e/studio-switcher.spec.ts` | Resolver throws `STUDIO_CONTEXT_REQUIRED`, UI prompts selector |
| 5. Multiple active memberships + valid selection | Integration | `tests/integration/studio-context.test.ts` | Resolves requested `StudioContext` |
| 6. Foreign studio cookie / argument | Unit / Integration | `tests/regressions/access.test.ts` | Fails closed (`STUDIO_CONTEXT_STALE` / `STUDIO_ACCESS_DENIED`) |
| 7. Malformed studio cookie | Unit / Integration | `tests/integration/studio-context.test.ts` | Returns `{ kind: "invalid" }` -> `STUDIO_CONTEXT_STALE` |
| 8. Inactive / revoked membership | Integration | `tests/regressions/access.test.ts` | Fails closed (`STUDIO_CONTEXT_STALE`) |
| 9. Studio switch data isolation | E2E | `tests/e2e/studio-switcher.spec.ts` | Switching studio updates active view; zero previous studio data shown |
| 10. Server action with forged studio ID | Regression | `tests/regressions/access.test.ts` | Rejects mutation with `STUDIO_ACCESS_DENIED` |
| 11. Worker execution with explicit studio ID | Integration | `tests/integration/worker.test.ts` | Processes job under `job.studioId` |
| 12. Valid Studio context + role grants permission + custom DENY override | Regression | `tests/regressions/access.test.ts` | Operation rejected with `FORBIDDEN_PERMISSION` (proves deny-overrides-allow) |
| 13. Valid Studio context + custom ALLOW override | Regression | `tests/regressions/access.test.ts` | Operation permitted (preserves custom allow override semantics) |

---

## 15. Database Impact

- **Database Migration Required**: **NO (0 migrations)**.
- **Justification**: Active studio context represents ephemeral navigation and session state. The database schema already models multi-tenancy correctly via `studio_members` and `studio_id` foreign keys on domain tables.

---

## 16. Security Invariants

1. **Explicit Context Required**: No studio-scoped domain read or mutation may execute without an authenticated user and an explicit, validated Studio context.
2. **Untrusted Client Transport**: The `pmu_active_studio` cookie is an untrusted request hint; it never constitutes proof of authorization.
3. **Mandatory Server Revalidation**: Active membership and studio activity must be revalidated against the database on every server security boundary.
4. **Zero Fallback**: Implicit "first-active row wins" resolution is completely prohibited in domain logic.
5. **Fail-Closed Security**: Missing, malformed, revoked, or foreign studio contexts must fail closed without disclosing foreign tenant metadata.
6. **Background Job Scope**: Background jobs and event handlers must derive tenant scope exclusively from trusted job payloads.
7. **Cache & State Isolation**: No tenant data may bleed across studio transitions via server or client caching.
8. **Permission Invariant**: Studio context proves tenant membership only. It does not itself prove capability authorization. Every permission-gated operation must use the canonical permission engine (`hasPermission`) and preserve custom overrides, including deny-overrides-allow semantics.

---

## 17. Phased Implementation Roadmap

- **PHASE 1.1B — Server Context Core**: Implement canonical cookie state primitives (`readActiveStudioCookieState`), single membership validator (`requireActiveStudioMembership`), remove implicit fallbacks from `getCurrentStudioId` and `resolveStudio`, and implement `requireBrowserStudioContext` / `requireStudioContextFor` in `src/server/auth/context.ts` and `src/server/auth/scopes.ts`.
- **PHASE 1.1C — Browser Bootstrap, Studio Switcher & Call-Site Migration**: Implement `setActiveStudioAction`, `clearActiveStudioAction`, `<SingleStudioBootstrap />`, `<StudioSelectorModal />`, `AppHeader` switcher component, `DashboardLayout` integration, and migrate all dashboard pages/actions.
- **PHASE 1.1D — Security, Regression & E2E Test Suite**: Implement multi-studio unit/integration tests (`tests/integration/studio-context.test.ts`, `tests/regressions/access.test.ts`) and Playwright E2E suite (`tests/e2e/studio-switcher.spec.ts`).
- **PHASE 1.1E — Final Phase 1.1 Acceptance**: Run complete test matrix, typecheck, lint, build, and verify zero regressions.

---

## 18. Open Questions & Risks

- **Risk**: Stale cookies during concurrent browser tab operations.
  - **Mitigation**: Server-side membership revalidation ensures actions fail safely if another tab revoked access.
- **Risk**: Test suites relying on implicit studio resolution.
  - **Mitigation**: Test helpers in `tests/support/` will be updated to explicitly set the active studio cookie or provide explicit context.
