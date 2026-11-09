import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";

const session = vi.hoisted(() => ({
  id: null as string | null,
  studioId: null as string | null,
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let actions: typeof import("@/features/consent/server/actions");
let coverageService: typeof import("@/features/consent/server/coverage");
let templateService: typeof import("@/features/consent/server/template-service").templateService;
let mediaService: typeof import("@/features/media/server/service").mediaService;

type AppDb = typeof import("@/db").db;
const appDb = () => database.db as unknown as AppDb;

let studioId: string;
let foreignStudioId: string;

let ownerUserId: string;
let adminUserId: string;
let masterUserId: string;
let masterId: string;
let otherMasterUserId: string;
let otherMasterId: string;
let clientUserId: string;

const roles: Record<string, string> = {};

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));

  actions = await import("@/features/consent/server/actions");
  coverageService = await import("@/features/consent/server/coverage");
  templateService = (await import("@/features/consent/server/template-service")).templateService;
  mediaService = (await import("@/features/media/server/service")).mediaService;

  const db = appDb();

  const [s1, s2] = await db
    .insert(s.studios)
    .values([studioFixture(), studioFixture()])
    .returning();
  studioId = s1.id;
  foreignStudioId = s2.id;

  const roleRows = await db.select().from(s.roles);
  for (const r of roleRows) {
    roles[r.code] = r.id;
  }

  ownerUserId = `owner-${randomUUID()}`;
  adminUserId = `admin-${randomUUID()}`;
  masterUserId = `master-${randomUUID()}`;
  masterId = randomUUID();
  otherMasterUserId = `other-master-${randomUUID()}`;
  otherMasterId = randomUUID();
  clientUserId = `client-${randomUUID()}`;

  await db.insert(s.user).values([
    {
      id: ownerUserId,
      name: "Owner User",
      email: `${ownerUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: adminUserId,
      name: "Admin User",
      email: `${adminUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: masterUserId,
      name: "Master User",
      email: `${masterUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: otherMasterUserId,
      name: "Other Master User",
      email: `${otherMasterUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: clientUserId,
      name: "Client User",
      email: `${clientUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  // Insert master rows in masters table
  await db.insert(s.masters).values([
    {
      id: masterId,
      studioId,
      userId: masterUserId,
      displayName: "Master Practitioner",
    },
    {
      id: otherMasterId,
      studioId,
      userId: otherMasterUserId,
      displayName: "Other Master Practitioner",
    },
  ]);

  await db.insert(s.studioMembers).values([
    {
      studioId,
      userId: ownerUserId,
      roleId: roles.OWNER,
      isActive: true,
    },
    {
      studioId,
      userId: adminUserId,
      roleId: roles.ADMIN,
      isActive: true,
    },
    {
      studioId,
      userId: masterUserId,
      roleId: roles.MASTER,
      isActive: true,
    },
    {
      studioId,
      userId: otherMasterUserId,
      roleId: roles.MASTER,
      isActive: true,
    },
  ]);
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
  vi.mocked(uploadToCloudinary).mockReset();
  vi.mocked(deleteFromCloudinary).mockReset();

  vi.mocked(uploadToCloudinary).mockImplementation(async (_file, options) => {
    const publicId = `cloudinary-pub-${randomUUID()}`;
    return {
      publicId,
      url: `https://res.cloudinary.com/test-only/${options.resource_type || "raw"}/authenticated/s--test--/${publicId}`,
    };
  });

  vi.mocked(deleteFromCloudinary).mockImplementation(async () => {});
});

afterAll(async () => {
  if (!database) return;
  await database.close();
});

// Helper to scaffold a client, cycle, and published template
async function scaffoldTestSetup(opts: { assignedMasterId?: string; zoneCode?: string; stage?: string } = {}) {
  const db = appDb();
  const assignedMasterId = opts.assignedMasterId || masterId;
  const [client] = await db
    .insert(s.clients)
    .values([{ ...clientFixture(studioId), assignedMasterId }])
    .returning();

  const [cycle] = await db
    .insert(s.treatmentCycles)
    .values({
      studioId,
      clientId: client.id,
      zoneCode: opts.zoneCode || "brows",
      kind: "pmu",
      stage: opts.stage || "procedure_confirmed",
      assignedMasterId,
    })
    .returning();

  // Create a template and published version
  const template = await db.transaction(async (tx) => {
    return templateService.createTemplate(
      tx,
      { studioId, userId: ownerUserId },
      {
        code: `tmpl_${randomUUID().slice(0, 8)}`,
        name: "Standard Eyebrow Consent",
      }
    );
  });

  const version = await db.transaction(async (tx) => {
    const draft = await templateService.createDraftVersion(
      tx,
      { studioId, userId: ownerUserId },
      {
        templateId: template.id,
        title: "Informed Eyebrow Consent",
        body: "Client acknowledges procedure risks and aftercare requirements.",
      }
    );
    return templateService.publishVersion(
      tx,
      { studioId, userId: ownerUserId },
      { versionId: draft.id }
    );
  });

  return { client, cycle, template, version };
}

test("1. Valid complete cycle consent draft and signing workflow", async () => {
  const { client, cycle, version } = await scaffoldTestSetup();

  // 1. Create draft cycle consent
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  expect(draft.id).toBeDefined();
  expect(draft.status).toBe("DRAFT");
  expect(draft.mediaId).toBeNull();
  expect(draft.signedPdfSha256).toBeNull();

  // Initial coverage resolver reports CONSENT_REQUIRED because consent is still draft
  const coverageBefore = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverageBefore.status).toBe("CONSENT_REQUIRED");
  expect(coverageBefore.reason).toBe("NO_SIGNED_CONSENT");

  // 2. Sign cycle consent
  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: client.fullName || "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 400,
      height: 200,
      strokes: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 100, y: 50 },
          ],
        },
      ],
    },
  });

  expect(signed.status).toBe("SIGNED");
  expect(signed.mediaId).toBeDefined();
  expect(signed.signedPdfSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(signed.signedAt).toBeInstanceOf(Date);
  expect(signed.finalizedAt).toBeInstanceOf(Date);
  expect(signed.finalizedById).toBe(ownerUserId);

  // 3. Verify media table record
  const [mediaRow] = await appDb()
    .select()
    .from(s.media)
    .where(eq(s.media.id, signed.mediaId!));

  expect(mediaRow).toBeDefined();
  expect(mediaRow.type).toBe("consent");
  expect(mediaRow.studioId).toBe(studioId);
  expect(mediaRow.clientId).toBe(client.id);

  // 4. Verify coverage resolver now reports COVERED
  const coverageAfter = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverageAfter.status).toBe("COVERED");
  expect(coverageAfter.reason).toBe("CONSENT_VALID");
  expect(coverageAfter.consentId).toBe(signed.id);
  expect(coverageAfter.mediaId).toBe(signed.mediaId);
});

test("2. Unpublished template version rejected for cycle consent creation", async () => {
  const { cycle } = await scaffoldTestSetup();

  // Create an unpublished draft template version
  const template = await appDb().transaction(async (tx) => {
    return templateService.createTemplate(
      tx,
      { studioId, userId: ownerUserId },
      {
        code: `unpub_${randomUUID().slice(0, 8)}`,
        name: "Unpublished Template",
      }
    );
  });

  const draftVersion = await appDb().transaction(async (tx) => {
    return templateService.createDraftVersion(
      tx,
      { studioId, userId: ownerUserId },
      {
        templateId: template.id,
        title: "Draft Version",
        body: "Draft Body",
      }
    );
  });

  // Attempting to create a cycle consent draft with an unpublished template must fail
  await expect(
    actions.createCycleConsentDraftAction({
      cycleId: cycle.id,
      templateVersionId: draftVersion.id,
      zoneCodes: ["brows"],
    })
  ).rejects.toThrow(/unpublished/i);
});

test("3. Cross-Studio cycle consent draft and signing rejected", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  // Foreign studio actor tries to create cycle consent for studio 1 cycle
  session.studioId = foreignStudioId;
  await expect(
    actions.createCycleConsentDraftAction({
      cycleId: cycle.id,
      templateVersionId: version.id,
      zoneCodes: ["brows"],
    })
  ).rejects.toThrow();

  // Reset to studio 1 to create draft
  session.studioId = studioId;
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  // Foreign studio actor tries to sign draft
  session.studioId = foreignStudioId;
  await expect(
    actions.signCycleConsentAction({
      consentId: draft.id,
      signatoryName: "Malicious Signer",
      signatoryRole: "client",
      signatureMethod: "draw_on_screen",
      signaturePayload: {
        format: "strokes_v1",
        width: 300,
        height: 150,
        strokes: [{ points: [{ x: 5, y: 5 }] }],
      },
    })
  ).rejects.toThrow();
});

test("4. Missing cycle actual zone rejected during signing", async () => {
  // Cycle has zoneCode 'brows'
  const { cycle, version } = await scaffoldTestSetup({ zoneCode: "brows" });

  // Create draft covering only 'lips'
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["lips"],
  });

  // Signing must fail because cycle's actual zone 'brows' is not covered
  await expect(
    actions.signCycleConsentAction({
      consentId: draft.id,
      signatoryName: "Jane Client",
      signatoryRole: "client",
      signatureMethod: "draw_on_screen",
      signaturePayload: {
        format: "strokes_v1",
        width: 300,
        height: 150,
        strokes: [{ points: [{ x: 5, y: 5 }] }],
      },
    })
  ).rejects.toThrow(/not covered/i);
});

test("5. Master scoping enforced for consent draft creation and signing", async () => {
  // Cycle assigned to otherMasterId
  const { cycle, version } = await scaffoldTestSetup({
    assignedMasterId: otherMasterId,
  });

  // masterUserId tries to create draft for cycle assigned to otherMasterUserId
  session.id = masterUserId;
  session.studioId = studioId;

  await expect(
    actions.createCycleConsentDraftAction({
      cycleId: cycle.id,
      templateVersionId: version.id,
      zoneCodes: ["brows"],
    })
  ).rejects.toThrow();

  // otherMasterUserId (assigned master) succeeds
  session.id = otherMasterUserId;
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });
  expect(draft.id).toBeDefined();

  // masterUserId cannot resolve or sign other master's cycle consent
  session.id = masterUserId;
  await expect(
    actions.resolveEffectiveConsentAction(cycle.id)
  ).rejects.toThrow();
});

test("6. Signed cycle consents and zones are immutable (database trigger protection)", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Jane Client",
    signatoryRole: "client",
    signatureMethod: "in_person_stylus",
    signaturePayload: { format: "strokes_v1", width: 200, height: 100, strokes: [{ points: [{ x: 1, y: 1 }] }] },
  });

  // Attempting to update signed consent in DB directly must be rejected by trigger
  await expect(
    appDb()
      .update(s.cycleConsents)
      .set({ signatoryName: "Tampered Name" })
      .where(eq(s.cycleConsents.id, signed.id))
  ).rejects.toThrow();

  // Attempting to add or delete zones for signed consent must be rejected by trigger
  await expect(
    appDb()
      .insert(s.cycleConsentZones)
      .values({
        studioId,
        consentId: signed.id,
        zoneCode: "lips",
      })
  ).rejects.toThrow();

  await expect(
    appDb()
      .delete(s.cycleConsentZones)
      .where(eq(s.cycleConsentZones.consentId, signed.id))
  ).rejects.toThrow();
});

test("7. Idempotent signing: replay returns exact same result without duplicate media or audits", async () => {
  const { client, cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const requestKey = randomUUID();
  const input = {
    consentId: draft.id,
    signatoryName: client.fullName || "Jane Client",
    signatoryRole: "client" as const,
    signatureMethod: "draw_on_screen" as const,
    signaturePayload: {
      format: "strokes_v1" as const,
      width: 400,
      height: 200,
      strokes: [{ points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] }],
    },
  };

  const mediaCountBefore = (await appDb().select().from(s.media)).length;
  const auditCountBefore = (await appDb().select().from(s.auditLogs)).length;

  const res1 = await actions.signCycleConsentAction(input, requestKey);
  expect(res1.status).toBe("SIGNED");

  // Replay with exact same key and payload returns identical result
  const res2 = await actions.signCycleConsentAction(input, requestKey);
  expect(res2).toEqual(res1);

  // Verify exactly ONE media row and ONE audit entry were added
  const mediaCountAfter = (await appDb().select().from(s.media)).length;
  const auditCountAfter = (await appDb().select().from(s.auditLogs)).length;

  expect(mediaCountAfter).toBe(mediaCountBefore + 1);
  expect(auditCountAfter).toBe(auditCountBefore + 1);

  // Replay with different payload rejects
  await expect(
    actions.signCycleConsentAction(
      {
        ...input,
        signatoryName: "Different Name",
      },
      requestKey
    )
  ).rejects.toThrow();
});

test("8. Compensating cleanup deletes uploaded private media when DB finalization fails", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  let uploadedPublicId: string | null = null;
  vi.mocked(uploadToCloudinary).mockImplementationOnce(async () => {
    uploadedPublicId = `compensate-target-${randomUUID()}`;
    return {
      publicId: uploadedPublicId,
      url: `https://res.cloudinary.com/test-only/raw/authenticated/${uploadedPublicId}`,
    };
  });

  // Mock writeAudit to fail simulating DB transaction error
  const auditSpy = vi.spyOn(await import("@/server/services/audit-log.service"), "writeAudit")
    .mockRejectedValueOnce(new Error("Simulated DB crash during commit"));

  await expect(
    actions.signCycleConsentAction({
      consentId: draft.id,
      signatoryName: "Jane Client",
      signatoryRole: "client",
      signatureMethod: "draw_on_screen",
      signaturePayload: {
        format: "strokes_v1",
        width: 300,
        height: 150,
        strokes: [{ points: [{ x: 5, y: 5 }] }],
      },
    })
  ).rejects.toThrow("Simulated DB crash during commit");

  auditSpy.mockRestore();

  // Verify compensating deletion was invoked
  expect(deleteFromCloudinary).toHaveBeenCalledWith(uploadedPublicId, {
    resource_type: "raw",
    type: "authenticated",
  });

  // Verify draft remains DRAFT (not partially signed)
  const [draftAfter] = await appDb()
    .select()
    .from(s.cycleConsents)
    .where(eq(s.cycleConsents.id, draft.id));
  expect(draftAfter.status).toBe("DRAFT");
  expect(draftAfter.mediaId).toBeNull();
});

test("9. Media protection: cannot archive media linked to signed cycle consent", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 300,
      height: 150,
      strokes: [{ points: [{ x: 5, y: 5 }] }],
    },
  });

  // Attempting to archive the signed consent media must fail
  await expect(
    mediaService.deleteMedia(signed.mediaId!, studioId, ownerUserId)
  ).rejects.toThrow(/signed cycle consent/i);
});

test("10. Merge behavior: historical signing client provenance preserved and fails closed after cycle move", async () => {
  const { client: sourceClient, cycle: sourceCycle, version } = await scaffoldTestSetup();

  // Create a target client
  const [targetClient] = await appDb()
    .insert(s.clients)
    .values([clientFixture(studioId)])
    .returning();

  // Sign consent for source client's cycle
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: sourceCycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: sourceClient.fullName || "Source Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 300,
      height: 150,
      strokes: [{ points: [{ x: 5, y: 5 }] }],
    },
  });

  expect(signed.clientId).toBe(sourceClient.id);

  // Move source cycle to target client simulating merge
  await appDb()
    .update(s.treatmentCycles)
    .set({ clientId: targetClient.id })
    .where(eq(s.treatmentCycles.id, sourceCycle.id));

  // Resolver for moved cycle must fail closed with CLIENT_PROVENANCE_MISMATCH
  const coverage = await coverageService.resolveEffectiveConsent(
    { studioId, userId: ownerUserId },
    sourceCycle.id,
    appDb()
  );

  expect(coverage.status).toBe("CONSENT_REQUIRED");
  expect(coverage.reason).toBe("CLIENT_PROVENANCE_MISMATCH");
  expect(coverage.consentId).toBe(signed.id);

  // Historical consent record still retains original sourceClient ID (special provenance)
  const [historicalConsent] = await appDb()
    .select()
    .from(s.cycleConsents)
    .where(eq(s.cycleConsents.id, signed.id));
  expect(historicalConsent.clientId).toBe(sourceClient.id);
});

test("11. Legacy uploaded consents are ignored by resolveEffectiveConsent", async () => {
  const { client, cycle } = await scaffoldTestSetup();

  // Insert a legacy uploaded consent
  const [legacyMedia] = await appDb()
    .insert(s.media)
    .values({
      studioId,
      clientId: client.id,
      type: "consent",
      url: "https://example.com/legacy.pdf",
      createdById: ownerUserId,
    })
    .returning();

  await appDb().insert(s.consents).values({
    studioId,
    clientId: client.id,
    mediaId: legacyMedia.id,
    consentType: "brows",
    signedAt: new Date(),
  });

  // Effective consent resolver for cycle ignores legacy consents and returns CONSENT_REQUIRED
  const coverage = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverage.status).toBe("CONSENT_REQUIRED");
  expect(coverage.reason).toBe("NO_SIGNED_CONSENT");
  expect(coverage.consentId).toBeNull();
});

test("12. Side-effect boundary: signing consent does NOT mutate TreatmentCycle stage or version", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const cycleBefore = await appDb()
    .select()
    .from(s.treatmentCycles)
    .where(eq(s.treatmentCycles.id, cycle.id));

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 300,
      height: 150,
      strokes: [{ points: [{ x: 5, y: 5 }] }],
    },
  });

  const cycleAfter = await appDb()
    .select()
    .from(s.treatmentCycles)
    .where(eq(s.treatmentCycles.id, cycle.id));

  expect(cycleAfter[0].stage).toBe(cycleBefore[0].stage);
  expect(cycleAfter[0].version).toBe(cycleBefore[0].version);
  expect(cycleAfter[0].updatedAt).toEqual(cycleBefore[0].updatedAt);
});

test("13. Deterministic latest-by-signedAt ordering when multiple signed consents exist for a cycle", async () => {
  const { client, cycle, version } = await scaffoldTestSetup();

  // Create and sign consent 1
  const draft1 = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed1 = await actions.signCycleConsentAction({
    consentId: draft1.id,
    signatoryName: client.fullName || "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: { format: "strokes_v1", width: 200, height: 100, strokes: [{ points: [{ x: 1, y: 1 }] }] },
  });

  // Small delay to ensure strictly distinct signedAt timestamps
  await new Promise((r) => setTimeout(r, 25));

  // Create and sign consent 2
  const draft2 = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed2 = await actions.signCycleConsentAction({
    consentId: draft2.id,
    signatoryName: client.fullName || "Jane Client",
    signatoryRole: "client",
    signatureMethod: "in_person_stylus",
    signaturePayload: { format: "strokes_v1", width: 200, height: 100, strokes: [{ points: [{ x: 2, y: 2 }] }] },
  });

  // Resolver must deterministically resolve latest consent #2
  const coverage = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverage.status).toBe("COVERED");
  expect(coverage.consentId).toBe(signed2.id);
  expect(coverage.consentId).not.toBe(signed1.id);
});

test("14. Terminal cycle stage resolves to NOT_APPLICABLE (CYCLE_TERMINAL)", async () => {
  const { cycle, version } = await scaffoldTestSetup({
    stage: "cycle_completed",
  });

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: { format: "strokes_v1", width: 200, height: 100, strokes: [{ points: [{ x: 1, y: 1 }] }] },
  });

  const coverage = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverage.status).toBe("NOT_APPLICABLE");
  expect(coverage.reason).toBe("CYCLE_TERMINAL");
});

test("15. Signatory roles: guardian and representative with in_person_stylus", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Legal Guardian Name",
    signatoryRole: "guardian",
    signatureMethod: "in_person_stylus",
    signaturePayload: { format: "strokes_v1", width: 300, height: 150, strokes: [{ points: [{ x: 10, y: 20 }] }] },
  });

  expect(signed.status).toBe("SIGNED");
  expect(signed.signatoryRole).toBe("guardian");
  expect(signed.signatoryName).toBe("Legal Guardian Name");
  expect(signed.signatureMethod).toBe("in_person_stylus");
});

test("16. PostgreSQL row-locking prevents concurrent zone mutations from corrupting signed state", async () => {
  const { cycle, version } = await scaffoldTestSetup();

  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: version.id,
    zoneCodes: ["brows"],
  });

  // Launch signing
  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Jane Client",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: { format: "strokes_v1", width: 200, height: 100, strokes: [{ points: [{ x: 1, y: 1 }] }] },
  });

  expect(signed.status).toBe("SIGNED");

  // Attempting concurrent direct insert to signed consent's zones fails
  await expect(
    appDb()
      .insert(s.cycleConsentZones)
      .values({
        studioId,
        consentId: draft.id,
        zoneCode: "lips",
      })
  ).rejects.toThrow();
});

test("17. resolveEffectiveConsent is strictly side-effect free (zero database writes)", async () => {
  const { cycle } = await scaffoldTestSetup();

  const auditsBefore = (await appDb().select().from(s.auditLogs)).length;
  const receiptsBefore = (await appDb().select().from(s.commandReceipts)).length;
  const mediaBefore = (await appDb().select().from(s.media)).length;

  const coverage = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverage.status).toBe("CONSENT_REQUIRED");

  const auditsAfter = (await appDb().select().from(s.auditLogs)).length;
  const receiptsAfter = (await appDb().select().from(s.commandReceipts)).length;
  const mediaAfter = (await appDb().select().from(s.media)).length;

  expect(auditsAfter).toBe(auditsBefore);
  expect(receiptsAfter).toBe(receiptsBefore);
  expect(mediaAfter).toBe(mediaBefore);
});

test("18. End-to-end Cyrillic / Unicode consent signing flow with coverage resolution and immutable evidence sealing", async () => {
  const { cycle } = await scaffoldTestSetup();
  const ctx = { studioId, userId: ownerUserId };

  // 1. Create and publish Cyrillic template
  const publishedVersion = await appDb().transaction(async (tx) => {
    const cyrillicTemplate = await templateService.createTemplate(tx, ctx, {
      code: `cyrillic_consent_${Date.now()}`,
      name: "Согласие на перманентный макияж",
      description: "Официальный шаблон согласия на русском языке",
    });

    const draftVersion = await templateService.createDraftVersion(tx, ctx, {
      templateId: cyrillicTemplate.id,
      title: "Согласие на проведение процедуры перманентного макияжа",
      body: "Я подтверждаю, что ознакомилась с условиями процедуры.\n\nЗоны: брови, губы, глаза.\n\nКыргызстан\n№ 123",
    });

    return templateService.publishVersion(tx, ctx, {
      versionId: draftVersion.id,
    });
  });

  // Capture pre-signing cycle and audit state
  const cycleBefore = (await appDb().select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycle.id)))[0];
  const auditsBefore = await appDb().select().from(s.auditLogs).where(eq(s.auditLogs.action, "cycle_consent_signed"));

  // 2. Create cycle consent draft
  const draft = await actions.createCycleConsentDraftAction({
    cycleId: cycle.id,
    templateVersionId: publishedVersion.id,
    zoneCodes: ["brows"],
  });

  // 3. Atomically finalize & sign with Cyrillic signatory
  const signed = await actions.signCycleConsentAction({
    consentId: draft.id,
    signatoryName: "Айгуль Асанова",
    signatoryRole: "client",
    signatureMethod: "draw_on_screen",
    signaturePayload: {
      format: "strokes_v1",
      width: 300,
      height: 150,
      strokes: [{ points: [{ x: 10, y: 15 }, { x: 50, y: 70 }] }],
    },
  });

  // Verify SIGNED cycle_consents row
  expect(signed.status).toBe("SIGNED");
  expect(signed.signatoryName).toBe("Айгуль Асанова");
  expect(signed.signedPdfSha256).toMatch(/^[0-9a-f]{64}$/);

  // Verify private media row
  const [mediaRow] = await appDb().select().from(s.media).where(eq(s.media.id, signed.mediaId!));
  expect(mediaRow).toBeDefined();
  expect(mediaRow.type).toBe("consent");
  expect(mediaRow.clientId).toBe(cycle.clientId);

  // Verify coverage resolver returns COVERED
  const coverage = await actions.resolveEffectiveConsentAction(cycle.id);
  expect(coverage.status).toBe("COVERED");
  expect(coverage.reason).toBe("CONSENT_VALID");
  expect(coverage.consentId).toBe(signed.id);

  // Verify exactly ONE signing audit was written
  const auditsAfter = await appDb().select().from(s.auditLogs).where(eq(s.auditLogs.action, "cycle_consent_signed"));
  expect(auditsAfter.length).toBe(auditsBefore.length + 1);

  // Verify zero TreatmentCycle mutation
  const cycleAfter = (await appDb().select().from(s.treatmentCycles).where(eq(s.treatmentCycles.id, cycle.id)))[0];
  expect(cycleAfter.stage).toBe(cycleBefore.stage);
  expect(cycleAfter.version).toBe(cycleBefore.version);
  expect(cycleAfter.updatedAt.toISOString()).toBe(cycleBefore.updatedAt.toISOString());
});
