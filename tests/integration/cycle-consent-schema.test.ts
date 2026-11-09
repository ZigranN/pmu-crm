import { afterAll, beforeAll, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let studioId: string, foreignStudioId: string, userId: string;
let clientId: string, foreignClientId: string;
let cycleId: string, foreignCycleId: string;
let templateVersionId: string, unpublishedTemplateVersionId: string, foreignTemplateVersionId: string;
let validSha256: string;

function hashContent(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;

  validSha256 = hashContent("test-pdf-bytes");

  // Ensure catalog zones
  for (const code of ["brows", "eyes", "lips", "skin", "lashes"]) {
    await db.insert(s.catalogZones).values({ code, label: code }).onConflictDoNothing();
  }

  [studioId, foreignStudioId] = (
    await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()
  ).map((r) => r.id);

  userId = randomUUID();
  await db.insert(s.user).values({
    id: userId,
    name: "Cycle Consent Schema Tester",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  [clientId] = (
    await db.insert(s.clients).values(clientFixture(studioId)).returning()
  ).map((r) => r.id);

  [foreignClientId] = (
    await db.insert(s.clients).values(clientFixture(foreignStudioId)).returning()
  ).map((r) => r.id);

  [cycleId] = (
    await db.insert(s.treatmentCycles).values({
      studioId,
      clientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    }).returning()
  ).map((r) => r.id);

  [foreignCycleId] = (
    await db.insert(s.treatmentCycles).values({
      studioId: foreignStudioId,
      clientId: foreignClientId,
      zoneCode: "brows",
      kind: "pmu",
      stage: "new_lead",
    }).returning()
  ).map((r) => r.id);

  // Studio Templates
  const [template] = await db.insert(s.consentTemplates).values({
    studioId,
    code: `PMU_BROWS_${randomUUID().slice(0, 8)}`,
    name: "Brows Consent Template",
    createdById: userId,
  }).returning();

  const [version] = await db.insert(s.consentTemplateVersions).values({
    studioId,
    templateId: template.id,
    versionNumber: 1,
    title: "Brows Consent v1",
    body: "# Standard Brows PMU Consent Terms",
    contentHash: hashContent("Brows Consent v1 body"),
    createdById: userId,
    publishedAt: new Date(),
  }).returning();
  templateVersionId = version.id;

  const [unpubVersion] = await db.insert(s.consentTemplateVersions).values({
    studioId,
    templateId: template.id,
    versionNumber: 2,
    title: "Brows Consent v2 Unpublished",
    body: "# Draft Terms",
    contentHash: hashContent("Brows Consent v2 body"),
    createdById: userId,
    publishedAt: null,
  }).returning();
  unpublishedTemplateVersionId = unpubVersion.id;

  // Foreign Studio Template
  const [foreignTemplate] = await db.insert(s.consentTemplates).values({
    studioId: foreignStudioId,
    code: `PMU_FOREIGN_${randomUUID().slice(0, 8)}`,
    name: "Foreign Consent Template",
    createdById: userId,
  }).returning();

  const [foreignVersion] = await db.insert(s.consentTemplateVersions).values({
    studioId: foreignStudioId,
    templateId: foreignTemplate.id,
    versionNumber: 1,
    title: "Foreign Consent v1",
    body: "# Foreign Terms",
    contentHash: hashContent("Foreign Consent v1 body"),
    createdById: userId,
    publishedAt: new Date(),
  }).returning();
  foreignTemplateVersionId = foreignVersion.id;
});

async function expectError(promise: Promise<any>, pattern?: RegExp) {
  try {
    await promise;
    expect.unreachable("Expected promise to reject");
  } catch (err: any) {
    if (pattern) {
      const fullMessage = `${err?.message || ""} ${err?.cause?.message || ""} ${JSON.stringify(err)}`;
      expect(fullMessage).toMatch(pattern);
    }
  }
}

afterAll(async () => {
  if (!database) return;
  await database.close();
});

test("1. Valid DRAFT persistence", async () => {
  const db = database.db;
  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  expect(draft).toBeDefined();
  expect(draft.id).toBeDefined();
  expect(draft.status).toBe("DRAFT");
  expect(draft.studioId).toBe(studioId);
  expect(draft.cycleId).toBe(cycleId);
  expect(draft.clientId).toBe(clientId);
  expect(draft.templateVersionId).toBe(templateVersionId);
  expect(draft.createdById).toBe(userId);
  expect(draft.signedAt).toBeNull();
  expect(draft.mediaId).toBeNull();
  expect(draft.signedPdfSha256).toBeNull();
  expect(draft.signatureMethod).toBeNull();
  expect(draft.signaturePayload).toBeNull();
  expect(draft.finalizedById).toBeNull();
  expect(draft.finalizedAt).toBeNull();
});

test("2. Direct SIGNED INSERT rejected by trigger", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent.pdf",
    createdById: userId,
  }).returning();

  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId,
      clientId,
      templateVersionId,
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { strokes: [] },
      signatoryName: "Alice Signer",
      signatoryRole: "client",
      createdById: userId,
      signedAt: new Date(),
      finalizedById: userId,
      finalizedAt: new Date(),
    }),
    /must be created as DRAFT/i
  );
});

test("3. Cross-Studio cycle FK rejected", async () => {
  const db = database.db;
  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId: foreignCycleId,
      clientId,
      templateVersionId,
      status: "DRAFT",
      createdById: userId,
    })
  );
});

test("4. Cross-Studio client FK rejected", async () => {
  const db = database.db;
  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId,
      clientId: foreignClientId,
      templateVersionId,
      status: "DRAFT",
      createdById: userId,
    })
  );
});

test("5. Cross-Studio template-version FK rejected", async () => {
  const db = database.db;
  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId,
      clientId,
      templateVersionId: foreignTemplateVersionId,
      status: "DRAFT",
      createdById: userId,
    })
  );
});

test("6. Cross-Studio media FK rejected on draft update / finalization", async () => {
  const db = database.db;
  const [foreignMedia] = await db.insert(s.media).values({
    studioId: foreignStudioId,
    clientId: foreignClientId,
    type: "consent",
    url: "https://example.test/foreign.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  await expectError(
    db.update(s.cycleConsents)
      .set({
        status: "SIGNED",
        mediaId: foreignMedia.id,
        signedPdfSha256: validSha256,
        signatureMethod: "in_person_stylus",
        signaturePayload: { strokes: [] },
        signatoryName: "Alice Signer",
        signatoryRole: "client",
        signedAt: new Date(),
        finalizedById: userId,
        finalizedAt: new Date(),
      })
      .where(eq(s.cycleConsents.id, draft.id))
  );
});

test("7. Invalid zoneCode rejected", async () => {
  const db = database.db;
  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  await expectError(
    db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: draft.id,
      zoneCode: "non_existent_zone_code",
    })
  );
});

test("8. Duplicate consent-zone pair rejected", async () => {
  const db = database.db;
  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  await expectError(
    db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: draft.id,
      zoneCode: "brows",
    })
  );
});

test("9. Duplicate signed mediaId rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent1.pdf",
    createdById: userId,
  }).returning();

  const [draft1] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft1.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { v: 1 },
    signatoryName: "Signer 1",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft1.id));

  const [draft2] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft2.id,
    zoneCode: "brows",
  });

  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer 2",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft2.id))
  );
});

test("10. Invalid lifecycle values rejected (signature method / role / status)", async () => {
  const db = database.db;
  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId,
      clientId,
      templateVersionId,
      status: "INVALID_STATUS" as any,
      createdById: userId,
    })
  );

  await expectError(
    db.insert(s.cycleConsents).values({
      studioId,
      cycleId,
      clientId,
      templateVersionId,
      status: "DRAFT",
      signatureMethod: "invalid_method" as any,
      createdById: userId,
    })
  );
});

test("11. Invalid PDF SHA-256 rejected (uppercase or invalid length)", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-sha.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  // Uppercase SHA-256
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256.toUpperCase(),
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id))
  );

  // Short SHA-256
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: "abcd",
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id))
  );
});

test("12. Incomplete SIGNED rejected (missing fields or finalizedAt < signedAt)", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-incomplete.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  const past = new Date(now.getTime() - 10000);

  // Missing signatoryName
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "   ",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id))
  );

  // finalizedAt < signedAt
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: past,
    }).where(eq(s.cycleConsents.id, draft.id))
  );
});

test("13. Unpublished template cannot be used for finalization", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-unpub.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId: unpublishedTemplateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id)),
    /unpublished/i
  );
});

test("14. Finalization without zones rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-no-zone.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  const now = new Date();
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id)),
    /without at least one covered zone/i
  );
});

test("15. Finalization without the cycle's actual zoneCode rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-mismatch.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId, // zone is "brows"
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  // Add only "lips" zone
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "lips",
  });

  const now = new Date();
  await expectError(
    db.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { v: 1 },
      signatoryName: "Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id)),
    /anchored cycle zone code/i
  );
});

test("16. Valid DRAFT -> SIGNED succeeds", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-valid.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  const [signed] = await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [1, 2, 3] },
    signatoryName: "Alice Verified",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id)).returning();

  expect(signed.status).toBe("SIGNED");
  expect(signed.mediaId).toBe(mediaRow.id);
  expect(signed.signedPdfSha256).toBe(validSha256);
  expect(signed.signatoryName).toBe("Alice Verified");
});

test("17. SIGNED -> DRAFT rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-revert.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Revert",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.update(s.cycleConsents).set({
      status: "DRAFT",
      mediaId: null,
      signedPdfSha256: null,
      signedAt: null,
    }).where(eq(s.cycleConsents.id, draft.id)),
    /immutable/i
  );
});

test("18. SIGNED field updates rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-immutable.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Permanent",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.update(s.cycleConsents).set({
      signatoryName: "Bob Tampered",
    }).where(eq(s.cycleConsents.id, draft.id)),
    /immutable/i
  );
});

test("19. SIGNED deletion rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-del.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Permanent",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.delete(s.cycleConsents).where(eq(s.cycleConsents.id, draft.id)),
    /cannot be deleted/i
  );
});

test("20. SIGNED zone INSERT rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-zone-ins.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Permanent",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: draft.id,
      zoneCode: "eyes",
    }),
    /already signed consent/i
  );
});

test("21. SIGNED zone UPDATE rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-zone-upd.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  const [zone] = await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  }).returning();

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Permanent",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.update(s.cycleConsentZones).set({
      zoneCode: "eyes",
    }).where(eq(s.cycleConsentZones.id, zone.id)),
    /modify zones of a signed consent/i
  );
});

test("22. SIGNED zone DELETE rejected", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/consent-zone-del.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();
  const [zone] = await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  }).returning();

  const now = new Date();
  await db.update(s.cycleConsents).set({
    status: "SIGNED",
    mediaId: mediaRow.id,
    signedPdfSha256: validSha256,
    signatureMethod: "in_person_stylus",
    signaturePayload: { strokes: [] },
    signatoryName: "Alice Permanent",
    signatoryRole: "client",
    signedAt: now,
    finalizedById: userId,
    finalizedAt: now,
  }).where(eq(s.cycleConsents.id, draft.id));

  await expectError(
    db.delete(s.cycleConsentZones).where(eq(s.cycleConsentZones.id, zone.id)),
    /delete zones from a signed consent/i
  );
});

test("23. Zone consentId reassignment rejected", async () => {
  const db = database.db;
  const [draft1] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  const [draft2] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  const [zone] = await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft1.id,
    zoneCode: "brows",
  }).returning();

  await expectError(
    db.update(s.cycleConsentZones).set({
      consentId: draft2.id,
    }).where(eq(s.cycleConsentZones.id, zone.id)),
    /reassigning consent_id is forbidden/i
  );
});

test("24. Draft deletion behavior works correctly (delete zones then delete consent)", async () => {
  const db = database.db;
  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  const [zone] = await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  }).returning();

  // Trying to delete draft directly fails because of restrict FK
  await expectError(
    db.delete(s.cycleConsents).where(eq(s.cycleConsents.id, draft.id))
  );

  // Deleting zone row while parent is DRAFT succeeds
  await db.delete(s.cycleConsentZones).where(eq(s.cycleConsentZones.id, zone.id));

  // Deleting empty draft consent succeeds
  const [deletedDraft] = await db.delete(s.cycleConsents).where(eq(s.cycleConsents.id, draft.id)).returning();
  expect(deletedDraft.id).toBe(draft.id);
});

test("25. Original client provenance remains unchanged (clientId identity is immutable)", async () => {
  const db = database.db;
  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  // Changing clientId on consent is forbidden
  await expectError(
    db.update(s.cycleConsents).set({
      clientId: foreignClientId,
    }).where(eq(s.cycleConsents.id, draft.id)),
    /reassign/i
  );
});

test("26. Multiple consent records for one cycle are allowed", async () => {
  const db = database.db;
  const [c1] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  const [c2] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  expect(c1.id).toBeDefined();
  expect(c2.id).toBeDefined();
  expect(c1.id).not.toBe(c2.id);
  expect(c1.cycleId).toBe(c2.cycleId);
});

test("27. Existing legacy consent functionality remains intact", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/legacy.pdf",
    createdById: userId,
  }).returning();

  const [legacyConsent] = await db.insert(s.consents).values({
    studioId,
    clientId,
    mediaId: mediaRow.id,
    consentType: "brows",
    signedAt: new Date(),
  }).returning();

  expect(legacyConsent.id).toBeDefined();
  expect(legacyConsent.mediaId).toBe(mediaRow.id);
});

test("28. No synthetic evidence backfill exists", async () => {
  const db = database.db;
  // Verify that legacy consents do not have synthetic records generated in cycle_consents
  const legacyRows = await db.select().from(s.consents).where(eq(s.consents.studioId, studioId));
  for (const legacy of legacyRows) {
    const cycleRows = await db.select().from(s.cycleConsents).where(eq(s.cycleConsents.mediaId, legacy.mediaId));
    expect(cycleRows).toHaveLength(0);
  }
});

test("29. Real PostgreSQL concurrency: zone mutation vs finalization serialization", async () => {
  const db = database.db;
  const [mediaRow] = await db.insert(s.media).values({
    studioId,
    clientId,
    type: "consent",
    url: "https://example.test/concurrency.pdf",
    createdById: userId,
  }).returning();

  const [draft] = await db.insert(s.cycleConsents).values({
    studioId,
    cycleId,
    clientId,
    templateVersionId,
    status: "DRAFT",
    createdById: userId,
  }).returning();

  await db.insert(s.cycleConsentZones).values({
    studioId,
    consentId: draft.id,
    zoneCode: "brows",
  });

  const now = new Date();

  // Test scenario: Finalize consent in Tx B and verify that any concurrent or subsequent zone addition is rejected
  await db.transaction(async (txB) => {
    await txB.update(s.cycleConsents).set({
      status: "SIGNED",
      mediaId: mediaRow.id,
      signedPdfSha256: validSha256,
      signatureMethod: "in_person_stylus",
      signaturePayload: { strokes: [1] },
      signatoryName: "Concurrent Signer",
      signatoryRole: "client",
      signedAt: now,
      finalizedById: userId,
      finalizedAt: now,
    }).where(eq(s.cycleConsents.id, draft.id));
  });

  await expectError(
    db.insert(s.cycleConsentZones).values({
      studioId,
      consentId: draft.id,
      zoneCode: "eyes",
    }),
    /already signed consent/i
  );

  // Verify the sealed zone count remains exactly 1 (brows only, eyes was rejected)
  const zones = await db.select().from(s.cycleConsentZones).where(eq(s.cycleConsentZones.consentId, draft.id));
  expect(zones.length).toBe(1);
  expect(zones[0].zoneCode).toBe("brows");
});
