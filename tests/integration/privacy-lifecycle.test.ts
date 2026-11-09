import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
  role: null as string | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => (session.id ? { user: { id: session.id } } : null),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "pmu_active_studio" && session.studioId
        ? { value: session.studioId }
        : undefined,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Phase 17: Privacy Lifecycle & Data Subject Requests", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof import("@/db").db;
  let actions: typeof import("@/features/privacy/server/actions");
  let queries: typeof import("@/features/privacy/server/queries");
  let exportService: typeof import("@/features/privacy/server/export-service");

  let studioId: string;
  let ownerUserId: string;
  let adminUserId: string;
  let masterUserId: string;
  let clientAId: string;
  let templateVersionId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    db = (await import("@/db")).db;
    actions = await import("@/features/privacy/server/actions");
    queries = await import("@/features/privacy/server/queries");
    exportService = await import("@/features/privacy/server/export-service");

    // Create studio
    [studioId] = (
      await db.insert(s.studios).values(studioFixture()).returning()
    ).map((r) => r.id);

    // Create users
    ownerUserId = randomUUID();
    adminUserId = randomUUID();
    masterUserId = randomUUID();

    await db.insert(s.user).values([
      { id: ownerUserId, name: "Studio Owner", email: `owner-${ownerUserId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: adminUserId, name: "Studio Admin", email: `admin-${adminUserId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      { id: masterUserId, name: "Studio Master", email: `master-${masterUserId}@example.test`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const rolesList = await db.select().from(s.roles);
    const ownerRole = rolesList.find((r) => r.code === "OWNER")!;
    const adminRole = rolesList.find((r) => r.code === "ADMIN")!;
    const masterRole = rolesList.find((r) => r.code === "MASTER")!;

    await db.insert(s.studioMembers).values([
      { userId: ownerUserId, studioId, roleId: ownerRole.id, isActive: true },
      { userId: adminUserId, studioId, roleId: adminRole.id, isActive: true },
      { userId: masterUserId, studioId, roleId: masterRole.id, isActive: true },
    ]);

    const [template] = await db
      .insert(s.consentTemplates)
      .values({
        studioId,
        code: "brows_consent",
        name: "Brows Consent",
        createdById: ownerUserId,
      })
      .returning();

    const [v] = await db
      .insert(s.consentTemplateVersions)
      .values({
        studioId,
        templateId: template.id,
        versionNumber: 1,
        title: "Brows Consent v1",
        body: "Consent body text",
        contentHash: "h".repeat(64),
        publishedAt: new Date(),
        createdById: ownerUserId,
      })
      .returning();

    templateVersionId = v.id;
  });

  beforeEach(async () => {
    // Reset session
    session.id = ownerUserId;
    session.studioId = studioId;
    session.role = "OWNER";

    // Create test client
    const [c] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Maria",
        lastName: "Rossi",
        fullName: "Maria Rossi",
        phone: "+393331112233",
        email: "maria.rossi@example.test",
        whatsapp: "+393331112233",
        notes: "Confidential customer notes",
        clientStatus: "new_lead",
      })
      .returning();
    clientAId = c.id;

    // Create a treatment cycle and signed consent
    const [cycle] = await db
      .insert(s.treatmentCycles)
      .values({
        studioId,
        clientId: clientAId,
        zoneCode: "brows",
        kind: "pmu",
      })
      .returning();

    const [mediaRow] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId: clientAId,
        type: "consent",
        url: "https://example.test/signed-consent.pdf",
        publicId: "consent-doc-1",
        caption: "Signed Brows Consent",
        createdById: ownerUserId,
      })
      .returning();

    const [consentRow] = await db.insert(s.cycleConsents).values({
      studioId,
      clientId: clientAId,
      cycleId: cycle.id,
      templateVersionId,
      status: "DRAFT",
      createdById: ownerUserId,
    }).returning();

    await db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: consentRow.id,
      zoneCode: "brows",
    });

    await db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedAt: new Date(),
      signedPdfSha256: "a".repeat(64),
      signatureMethod: "in_person_stylus",
      signaturePayload: { data: "sig-payload" },
      signatoryName: "Maria Rossi",
      signatoryRole: "client",
      finalizedById: ownerUserId,
      finalizedAt: new Date(),
    }).where(eq(s.cycleConsents.id, consentRow.id));

    // Create ledger entry
    await db.insert(s.ledgerEntries).values({
      studioId,
      clientId: clientAId,
      type: "CHARGE",
      amountMinor: 15000,
      currency: "EUR",
      reason: "Initial procedure fee",
      createdById: ownerUserId,
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  describe("1. Privacy Request State Machine & Export Aggregator", () => {
    it("creates an EXPORT request as ADMIN and approves it as OWNER to generate export bundle", async () => {
      session.id = adminUserId;
      session.role = "ADMIN";

      const createRes = await actions.createPrivacyRequestAction({
        clientId: clientAId,
        requestType: "EXPORT",
        reason: "Client DSAR request",
      });
      expect(createRes.success).toBe(true);
      expect(createRes.requestId).toBeDefined();

      const requests = await queries.getPrivacyRequests(studioId);
      const req = requests.find((r) => r.id === createRes.requestId);
      expect(req).toBeDefined();
      expect(req?.status).toBe("REQUESTED");
      expect(req?.clientName).toBe("Maria Rossi");

      // Approve as OWNER
      session.id = ownerUserId;
      session.role = "OWNER";

      const approveRes = await actions.approvePrivacyRequestAction({ requestId: createRes.requestId });
      expect(approveRes.success).toBe(true);

      const afterApprove = await queries.getPrivacyRequests(studioId);
      const approvedReq = afterApprove.find((r) => r.id === createRes.requestId);
      expect(approvedReq?.status).toBe("COMPLETED");
      expect(approvedReq?.exportArtifactId).not.toBeNull();
      expect(approvedReq?.exportExpiresAt).not.toBeNull();

      // Verify export bundle content
      const bundle = await exportService.buildClientExportBundle(studioId, clientAId, db);
      expect(bundle.manifest.clientId).toBe(clientAId);
      expect(bundle.manifest.recordCounts.client).toBe(1);
      expect(bundle.manifest.recordCounts.treatmentCycles).toBe(1);
      expect(bundle.manifest.recordCounts.cycleConsents).toBe(1);
      expect(bundle.manifest.recordCounts.ledgerEntries).toBe(1);
      expect((bundle.client as any).fullName).toBe("Maria Rossi");
    });

    it("allows cancelling a requested privacy request", async () => {
      session.id = adminUserId;
      session.role = "ADMIN";

      const createRes = await actions.createPrivacyRequestAction({
        clientId: clientAId,
        requestType: "EXPORT",
        reason: "Client request",
      });

      const cancelRes = await actions.cancelPrivacyRequestAction({
        requestId: createRes.requestId,
        reason: "Cancelled per client phone call",
      });
      expect(cancelRes.success).toBe(true);

      const history = await queries.getClientPrivacyHistory(clientAId, studioId);
      const cancelledReq = history.find((r) => r.id === createRes.requestId);
      expect(cancelledReq?.status).toBe("CANCELLED");
      expect(cancelledReq?.failureReason).toBe("Cancelled per client phone call");
    });
  });

  describe("2. Client Anonymization & Invariant Preservation", () => {
    it("anonymizes client PII while strictly preserving primary key, signed consent, and append-only ledger", async () => {
      const [beforeLedger] = await db
        .select()
        .from(s.ledgerEntries)
        .where(eq(s.ledgerEntries.clientId, clientAId));
      const [beforeConsent] = await db
        .select()
        .from(s.cycleConsents)
        .where(eq(s.cycleConsents.clientId, clientAId));

      session.id = ownerUserId;
      session.role = "OWNER";

      const anonRes = await actions.anonymizeClientAction({
        clientId: clientAId,
        confirmClientName: "Maria Rossi",
        reason: "GDPR Right to be Forgotten",
      });
      expect(anonRes.success).toBe(true);

      // Verify client row direct PII replaced with deterministic placeholders
      const [anonymizedClient] = await db
        .select()
        .from(s.clients)
        .where(eq(s.clients.id, clientAId));

      expect(anonymizedClient.id).toBe(clientAId); // Stable primary key
      expect(anonymizedClient.firstName).toBe("Anonymized");
      expect(anonymizedClient.lastName).toBe("Client");
      expect(anonymizedClient.fullName).toBe("Anonymized Client");
      expect(anonymizedClient.phone).toBe("+000000000000");
      expect(anonymizedClient.email).toBeNull();
      expect(anonymizedClient.whatsapp).toBeNull();
      expect(anonymizedClient.notes).toBeNull();

      // Postgres generated search index keys automatically updated
      expect(anonymizedClient.nameKey).toBe("anonymized client");

      // Verify append-only ledger entries untouched
      const [afterLedger] = await db
        .select()
        .from(s.ledgerEntries)
        .where(eq(s.ledgerEntries.clientId, clientAId));
      expect(afterLedger).toEqual(beforeLedger);

      // Verify signed consent record and evidence hashes untouched
      const [afterConsent] = await db
        .select()
        .from(s.cycleConsents)
        .where(eq(s.cycleConsents.clientId, clientAId));
      expect(afterConsent).toEqual(beforeConsent);
    });

    it("rejects anonymization if confirmation name does not match", async () => {
      session.id = ownerUserId;
      session.role = "OWNER";

      await expect(
        actions.anonymizeClientAction({
          clientId: clientAId,
          confirmClientName: "Wrong Name",
          reason: "GDPR Request",
        })
      ).rejects.toThrow(/does not match/i);
    });
  });

  describe("3. Permission Enforcement", () => {
    it("rejects MASTER from creating or approving anonymization", async () => {
      session.id = masterUserId;
      session.role = "MASTER";

      await expect(
        actions.anonymizeClientAction({
          clientId: clientAId,
          confirmClientName: "Maria Rossi",
          reason: "Unauthorized attempt",
        })
      ).rejects.toThrow(/Permission denied|FORBIDDEN_PERMISSION/i);
    });
  });
});
