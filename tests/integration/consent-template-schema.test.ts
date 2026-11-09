import { afterAll, beforeAll, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let studioId: string, foreignStudioId: string, userId: string;

function hashContent(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

beforeAll(async () => {
  database = await createTestDatabase();
  const db = database.db;

  [studioId, foreignStudioId] = (
    await db.insert(s.studios).values([studioFixture(), studioFixture()]).returning()
  ).map((r) => r.id);

  userId = randomUUID();
  await db.insert(s.user).values({
    id: userId,
    name: "Consent Schema Tester",
    email: `${userId}@example.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  if (!database) return;
  try {
    if (studioId) {
      await database.db.delete(s.studios).where(inArray(s.studios.id, [studioId, foreignStudioId]));
    }
    await database.db.delete(s.user).where(eq(s.user.id, userId));
  } finally {
    await database.close();
  }
});

test("1. Studio creates logical template row", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: "PMU_STANDARD_BROWS",
      name: "Standard Brows PMU Consent",
      description: "Standard procedural consent for eyebrows PMU",
      createdById: userId,
    })
    .returning();

  expect(template).toBeDefined();
  expect(template.id).toBeDefined();
  expect(template.studioId).toBe(studioId);
  expect(template.code).toBe("PMU_STANDARD_BROWS");
  expect(template.name).toBe("Standard Brows PMU Consent");
  expect(template.description).toBe("Standard procedural consent for eyebrows PMU");
  expect(template.createdById).toBe(userId);
  expect(template.createdAt).toBeInstanceOf(Date);
  expect(template.archivedAt).toBeNull();
});

test("2. Duplicate template code within same Studio rejected", async () => {
  const db = database.db;
  const code = `CODE_DUP_${randomUUID().slice(0, 8)}`;

  await db.insert(s.consentTemplates).values({
    studioId,
    code,
    name: "Original Template",
    createdById: userId,
  });

  await expect(
    db.insert(s.consentTemplates).values({
      studioId,
      code,
      name: "Duplicate Template",
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("3. Same template code in different Studios allowed", async () => {
  const db = database.db;
  const code = `SHARED_CODE_${randomUUID().slice(0, 8)}`;

  const [t1] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code,
      name: "Studio 1 Template",
      createdById: userId,
    })
    .returning();

  const [t2] = await db
    .insert(s.consentTemplates)
    .values({
      studioId: foreignStudioId,
      code,
      name: "Foreign Studio Template",
      createdById: userId,
    })
    .returning();

  expect(t1.id).not.toBe(t2.id);
  expect(t1.studioId).toBe(studioId);
  expect(t2.studioId).toBe(foreignStudioId);
  expect(t1.code).toBe(code);
  expect(t2.code).toBe(code);
});

test("4. Multiple versions of one template persist", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `MULTI_VER_${randomUUID().slice(0, 8)}`,
      name: "Multi-Version Template",
      createdById: userId,
    })
    .returning();

  const body1 = "Version 1 source body text content.";
  const body2 = "Version 2 updated source body text content.";

  const [v1] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Consent Form v1",
      body: body1,
      contentHash: hashContent(body1),
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  const [v2] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 2,
      title: "Consent Form v2",
      body: body2,
      contentHash: hashContent(body2),
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  const versions = await db
    .select()
    .from(s.consentTemplateVersions)
    .where(eq(s.consentTemplateVersions.templateId, template.id))
    .orderBy(s.consentTemplateVersions.versionNumber);

  expect(versions).toHaveLength(2);
  expect(versions[0].id).toBe(v1.id);
  expect(versions[0].versionNumber).toBe(1);
  expect(versions[1].id).toBe(v2.id);
  expect(versions[1].versionNumber).toBe(2);
});

test("5. Duplicate version number rejected", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `DUP_VER_${randomUUID().slice(0, 8)}`,
      name: "Duplicate Version Test",
      createdById: userId,
    })
    .returning();

  const body = "Initial version body.";
  await db.insert(s.consentTemplateVersions).values({
    studioId,
    templateId: template.id,
    versionNumber: 1,
    title: "Version 1",
    body,
    contentHash: hashContent(body),
    createdById: userId,
  });

  await expect(
    db.insert(s.consentTemplateVersions).values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Duplicate Version 1",
      body: "Another body",
      contentHash: hashContent("Another body"),
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("6. Version number 0 or negative rejected", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `ZERO_VER_${randomUUID().slice(0, 8)}`,
      name: "Zero Version Test",
      createdById: userId,
    })
    .returning();

  const body = "Body text";
  await expect(
    db.insert(s.consentTemplateVersions).values({
      studioId,
      templateId: template.id,
      versionNumber: 0,
      title: "Version 0",
      body,
      contentHash: hashContent(body),
      createdById: userId,
    })
  ).rejects.toThrow();

  await expect(
    db.insert(s.consentTemplateVersions).values({
      studioId,
      templateId: template.id,
      versionNumber: -1,
      title: "Version -1",
      body,
      contentHash: hashContent(body),
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("7. Invalid template FK rejected", async () => {
  const db = database.db;
  const nonExistentTemplateId = randomUUID();
  const body = "Body text";

  await expect(
    db.insert(s.consentTemplateVersions).values({
      studioId,
      templateId: nonExistentTemplateId,
      versionNumber: 1,
      title: "Orphan Version",
      body,
      contentHash: hashContent(body),
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("8. Cross-Studio template/version mismatch rejected at DB level", async () => {
  const db = database.db;
  // Template created in studioId
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `CROSS_STUDIO_${randomUUID().slice(0, 8)}`,
      name: "Studio A Template",
      createdById: userId,
    })
    .returning();

  const body = "Body text";
  // Attempt to create a version under foreignStudioId referencing template in studioId
  await expect(
    db.insert(s.consentTemplateVersions).values({
      studioId: foreignStudioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Cross Studio Version",
      body,
      contentHash: hashContent(body),
      createdById: userId,
    })
  ).rejects.toThrow();
});

test("9. Published version source content cannot be updated", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `IMMUTABLE_PUB_${randomUUID().slice(0, 8)}`,
      name: "Published Immutability Test",
      createdById: userId,
    })
    .returning();

  const body = "Original published body.";
  const [version] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Published v1",
      body,
      contentHash: hashContent(body),
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  // Attempting to update title or body must fail
  await expect(
    db
      .update(s.consentTemplateVersions)
      .set({ title: "Tampered Title" })
      .where(eq(s.consentTemplateVersions.id, version.id))
  ).rejects.toThrow();

  await expect(
    db
      .update(s.consentTemplateVersions)
      .set({ body: "Tampered body", contentHash: hashContent("Tampered body") })
      .where(eq(s.consentTemplateVersions.id, version.id))
  ).rejects.toThrow();
});

test("10. Published version cannot be physically deleted", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `DELETE_PUB_${randomUUID().slice(0, 8)}`,
      name: "Delete Published Test",
      createdById: userId,
    })
    .returning();

  const body = "Published version to delete";
  const [version] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Published v1",
      body,
      contentHash: hashContent(body),
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  await expect(
    db.delete(s.consentTemplateVersions).where(eq(s.consentTemplateVersions.id, version.id))
  ).rejects.toThrow();
});

test("11. A later version does not modify an earlier published version", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `VERSION_ISOLATION_${randomUUID().slice(0, 8)}`,
      name: "Version Isolation Test",
      createdById: userId,
    })
    .returning();

  const body1 = "Original body of version 1";
  const hash1 = hashContent(body1);
  const [v1] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Consent v1",
      body: body1,
      contentHash: hash1,
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  const body2 = "Updated body of version 2";
  const hash2 = hashContent(body2);
  const [v2] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 2,
      title: "Consent v2",
      body: body2,
      contentHash: hash2,
      createdById: userId,
      publishedAt: new Date(),
    })
    .returning();

  const [rereadV1] = await db
    .select()
    .from(s.consentTemplateVersions)
    .where(eq(s.consentTemplateVersions.id, v1.id));

  expect(v2.versionNumber).toBe(2);
  expect(rereadV1.title).toBe("Consent v1");
  expect(rereadV1.body).toBe(body1);
  expect(rereadV1.contentHash).toBe(hash1);
  expect(rereadV1.versionNumber).toBe(1);
});

test("12. Draft editing remains possible if permitted by chosen schema", async () => {
  const db = database.db;
  const [template] = await db
    .insert(s.consentTemplates)
    .values({
      studioId,
      code: `DRAFT_EDIT_${randomUUID().slice(0, 8)}`,
      name: "Draft Editing Test",
      createdById: userId,
    })
    .returning();

  const draftBody = "Initial draft body text.";
  const [draft] = await db
    .insert(s.consentTemplateVersions)
    .values({
      studioId,
      templateId: template.id,
      versionNumber: 1,
      title: "Draft Version 1.0",
      body: draftBody,
      contentHash: hashContent(draftBody),
      createdById: userId,
      publishedAt: null, // Draft
    })
    .returning();

  // Edit the draft
  const updatedBody = "Refined draft body text with amendments.";
  const [updatedDraft] = await db
    .update(s.consentTemplateVersions)
    .set({
      title: "Draft Version 1.1",
      body: updatedBody,
      contentHash: hashContent(updatedBody),
    })
    .where(eq(s.consentTemplateVersions.id, draft.id))
    .returning();

  expect(updatedDraft.title).toBe("Draft Version 1.1");
  expect(updatedDraft.body).toBe(updatedBody);
  expect(updatedDraft.publishedAt).toBeNull();

  // Publish the draft
  const publishTime = new Date();
  const [published] = await db
    .update(s.consentTemplateVersions)
    .set({ publishedAt: publishTime })
    .where(eq(s.consentTemplateVersions.id, draft.id))
    .returning();

  expect(published.publishedAt).toBeInstanceOf(Date);

  // Once published, further edits must fail
  await expect(
    db
      .update(s.consentTemplateVersions)
      .set({ title: "Post-Publish Edit" })
      .where(eq(s.consentTemplateVersions.id, draft.id))
  ).rejects.toThrow();
});

test("13. Existing legacy consent rows remain unchanged", async () => {
  const db = database.db;
  const [client] = await db.insert(s.clients).values(clientFixture(studioId)).returning();

  // Create dummy media record for legacy consent
  const [media] = await db
    .insert(s.media)
    .values({
      studioId,
      clientId: client.id,
      url: "https://example.test/legacy-consent.pdf",
      publicId: `legacy-media-${randomUUID()}`,
      type: "consent",
      createdById: userId,
    })
    .returning();

  const signedDate = new Date("2026-01-15T10:00:00Z");
  const [legacyConsent] = await db
    .insert(s.consents)
    .values({
      studioId,
      clientId: client.id,
      mediaId: media.id,
      consentType: "pmu_general",
      signedAt: signedDate,
    })
    .returning();

  const [rereadConsent] = await db
    .select()
    .from(s.consents)
    .where(eq(s.consents.id, legacyConsent.id));

  expect(rereadConsent).toBeDefined();
  expect(rereadConsent.studioId).toBe(studioId);
  expect(rereadConsent.clientId).toBe(client.id);
  expect(rereadConsent.consentType).toBe("pmu_general");
  expect(rereadConsent.mediaId).toBe(media.id);
  expect(new Date(rereadConsent.signedAt).getTime()).toBe(signedDate.getTime());
});

test("14. Migration creates no synthetic templates or versions", async () => {
  const db = database.db;
  // A fresh studio has zero templates and zero versions automatically seeded
  const [freshStudio] = await db.insert(s.studios).values(studioFixture()).returning();

  const studioTemplates = await db
    .select()
    .from(s.consentTemplates)
    .where(eq(s.consentTemplates.studioId, freshStudio.id));
  expect(studioTemplates).toHaveLength(0);

  const studioVersions = await db
    .select()
    .from(s.consentTemplateVersions)
    .where(eq(s.consentTemplateVersions.studioId, freshStudio.id));
  expect(studioVersions).toHaveLength(0);
});
