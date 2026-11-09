import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { computeCanonicalTemplateHash } from "@/features/consent/server/canonical-hash";

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
let queries: typeof import("@/features/consent/server/template-queries");
let service: typeof import("@/features/consent/server/template-service").templateService;

type AppDb = typeof import("@/db").db;
const appDb = () => database.db as unknown as AppDb;

let studioId: string;
let foreignStudioId: string;

let ownerUserId: string;
let adminUserId: string;
let masterUserId: string;
let clientUserId: string;

const roles: Record<string, string> = {};

beforeAll(async () => {
  database = await createTestDatabase();
  vi.doMock("@/db", () => ({ db: database.db }));

  actions = await import("@/features/consent/server/actions");
  queries = await import("@/features/consent/server/template-queries");
  service = (await import("@/features/consent/server/template-service")).templateService;

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
      id: clientUserId,
      name: "Client User",
      email: `${clientUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
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
  ]);
});

beforeEach(() => {
  session.id = ownerUserId;
  session.studioId = studioId;
});

afterAll(async () => {
  if (!database) return;
  try {
    const db = appDb();
    if (studioId) {
      await db
        .delete(s.studios)
        .where(inArray(s.studios.id, [studioId, foreignStudioId]));
    }
    await db
      .delete(s.user)
      .where(
        inArray(s.user.id, [
          ownerUserId,
          adminUserId,
          masterUserId,
          clientUserId,
        ])
      );
  } finally {
    await database.close();
  }
});

test("1. Authorized template creation succeeds and sets studio context and actor", async () => {
  const result = await actions.createConsentTemplateAction({
    code: "pmu_standard",
    name: "Standard PMU Procedure Consent",
    description: "General consent for PMU cosmetic treatments",
  });

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.code).toBe("pmu_standard");
  expect(result.name).toBe("Standard PMU Procedure Consent");

  const loaded = await queries.getConsentTemplateById(studioId, result.id, appDb());
  expect(loaded).toBeDefined();
  expect(loaded?.studioId).toBe(studioId);
  expect(loaded?.createdById).toBe(ownerUserId);
  expect(loaded?.archivedAt).toBeNull();
});

test("2. Duplicate template code rejected within the same Studio", async () => {
  const code = `dup_code_${randomUUID().slice(0, 8)}`;
  await actions.createConsentTemplateAction({
    code,
    name: "Original Template",
  });

  await expect(
    actions.createConsentTemplateAction({
      code,
      name: "Duplicate Template",
    })
  ).rejects.toThrow();
});

test("3. Same template code allowed in another Studio", async () => {
  const sharedCode = `shared_${randomUUID().slice(0, 8)}`;

  // Create in Studio 1
  session.studioId = studioId;
  const t1 = await actions.createConsentTemplateAction({
    code: sharedCode,
    name: "Studio 1 Template",
  });
  expect(t1.id).toBeDefined();

  // Create in foreign Studio
  // Insert membership for owner in foreign studio
  await appDb().insert(s.studioMembers).values({
    studioId: foreignStudioId,
    userId: ownerUserId,
    roleId: roles.OWNER,
    isActive: true,
  });

  session.studioId = foreignStudioId;
  const t2 = await actions.createConsentTemplateAction({
    code: sharedCode,
    name: "Studio 2 Template",
  });
  expect(t2.id).toBeDefined();
  expect(t2.id).not.toBe(t1.id);
});

test("4. Cross-Studio read rejected", async () => {
  session.studioId = studioId;
  const t1 = await actions.createConsentTemplateAction({
    code: `read_test_${randomUUID().slice(0, 8)}`,
    name: "Studio 1 Only",
  });

  // Querying template from foreign studio context returns null
  const foreignRead = await queries.getConsentTemplateById(
    foreignStudioId,
    t1.id,
    appDb()
  );
  expect(foreignRead).toBeNull();
});

test("5. Archive template sets server timestamp", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `archive_test_${randomUUID().slice(0, 8)}`,
    name: "Template to Archive",
  });

  const archived = await actions.archiveConsentTemplateAction(template.id);
  expect(archived.archivedAt).toBeInstanceOf(Date);

  const loaded = await queries.getConsentTemplateById(studioId, template.id, appDb());
  expect(loaded?.archivedAt).not.toBeNull();
});

test("6. Archived template rejects new draft version creation", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `arch_ver_${randomUUID().slice(0, 8)}`,
    name: "Archived Template",
  });

  await actions.archiveConsentTemplateAction(template.id);

  await expect(
    actions.createConsentTemplateDraftVersionAction({
      templateId: template.id,
      title: "Draft 1",
      body: "Body text",
    })
  ).rejects.toThrow(/archived/i);
});

test("7. Create version #1 allocates version 1 server-side", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `ver1_test_${randomUUID().slice(0, 8)}`,
    name: "Version 1 Test",
  });

  const v1 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Initial Draft Title",
    body: "Initial Draft Body Text",
  });

  expect(v1.versionNumber).toBe(1);

  const loaded = await queries.getConsentTemplateVersionById(
    studioId,
    v1.id,
    appDb()
  );
  expect(loaded?.versionNumber).toBe(1);
  expect(loaded?.publishedAt).toBeNull();
  expect(loaded?.createdById).toBe(ownerUserId);
});

test("8. Create later version #2 allocates sequential version number", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `ver2_test_${randomUUID().slice(0, 8)}`,
    name: "Version 2 Test",
  });

  const v1 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Version 1",
    body: "Body 1",
  });
  expect(v1.versionNumber).toBe(1);

  const v2 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Version 2",
    body: "Body 2",
  });
  expect(v2.versionNumber).toBe(2);
});

test("9. Version numbers are strictly allocated server-side", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `seq_test_${randomUUID().slice(0, 8)}`,
    name: "Sequential Test",
  });

  // Client cannot supply version number (it is not part of the schema)
  const v1 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "V1",
    body: "Body",
  });
  const v2 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "V2",
    body: "Body",
  });

  expect(v1.versionNumber).toBe(1);
  expect(v2.versionNumber).toBe(2);
});

test("10. Deterministic SHA-256 computed server-side", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `sha_test_${randomUUID().slice(0, 8)}`,
    name: "SHA Test",
  });

  const title = "Clinical PMU Agreement";
  const body = "Patient acknowledges full awareness of procedure risks.";

  const expectedHash = computeCanonicalTemplateHash({ title, body });

  const v1 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title,
    body,
  });

  expect(v1.contentHash).toBe(expectedHash);
  expect(v1.contentHash).toMatch(/^[0-9a-f]{64}$/);
});

test("11. Client-supplied hash is impossible / ignored by contract schema", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `client_hash_${randomUUID().slice(0, 8)}`,
    name: "Client Hash Test",
  });

  const title = "Safe Title";
  const body = "Safe Body";
  const fakeHash = "0000000000000000000000000000000000000000000000000000000000000000";

  // createConsentTemplateDraftVersionSchema is strict and rejects unknown properties
  await expect(
    actions.createConsentTemplateDraftVersionAction({
      templateId: template.id,
      title,
      body,
      // @ts-expect-error client passing forbidden property
      contentHash: fakeHash,
    })
  ).rejects.toThrow();
});

test("12. Draft title/body update recomputes hash", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `update_hash_${randomUUID().slice(0, 8)}`,
    name: "Update Hash Test",
  });

  const v1 = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Original Title",
    body: "Original Body",
  });

  const updated = await actions.updateConsentTemplateDraftVersionAction({
    versionId: v1.id,
    title: "Updated Title",
    body: "Updated Body",
  });

  const expectedUpdatedHash = computeCanonicalTemplateHash({
    title: "Updated Title",
    body: "Updated Body",
  });

  expect(updated.title).toBe("Updated Title");
  expect(updated.body).toBe("Updated Body");
  expect(updated.contentHash).toBe(expectedUpdatedHash);
  expect(updated.contentHash).not.toBe(v1.contentHash);
});

test("13. Published version cannot be edited", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `immut_test_${randomUUID().slice(0, 8)}`,
    name: "Immutability Test",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Immutable Title",
    body: "Immutable Body",
  });

  await actions.publishConsentTemplateVersionAction(draft.id);

  // Application command must reject editing published versions
  await expect(
    actions.updateConsentTemplateDraftVersionAction({
      versionId: draft.id,
      title: "Mutated Title",
      body: "Mutated Body",
    })
  ).rejects.toThrow(/published.*cannot be edited/i);
});

test("14. Draft publication succeeds and sets immutable state", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `publish_test_${randomUUID().slice(0, 8)}`,
    name: "Publish Success Test",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "To Publish Title",
    body: "To Publish Body",
  });

  const published = await actions.publishConsentTemplateVersionAction(draft.id);
  expect(published.publishedAt).toBeInstanceOf(Date);

  const loaded = await queries.getConsentTemplateVersionById(
    studioId,
    draft.id,
    appDb()
  );
  expect(loaded?.publishedAt).not.toBeNull();
});

test("15. Publication timestamp comes strictly from server", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `server_time_${randomUUID().slice(0, 8)}`,
    name: "Server Time Test",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Time Title",
    body: "Time Body",
  });

  const beforePublish = Date.now();
  const published = await actions.publishConsentTemplateVersionAction(draft.id);
  const afterPublish = Date.now();

  const publishedTime = new Date(published.publishedAt!).getTime();
  expect(publishedTime).toBeGreaterThanOrEqual(beforePublish - 1000);
  expect(publishedTime).toBeLessThanOrEqual(afterPublish + 1000);
});

test("16. Published hash matches persisted title/body", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `match_hash_${randomUUID().slice(0, 8)}`,
    name: "Match Hash Test",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Persisted Title",
    body: "Persisted Body",
  });

  const published = await actions.publishConsentTemplateVersionAction(draft.id);

  const expectedHash = computeCanonicalTemplateHash({
    title: "Persisted Title",
    body: "Persisted Body",
  });
  expect(published.contentHash).toBe(expectedHash);
});

test("17. Repeated publication does not mutate original publication timestamp", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `repeat_pub_${randomUUID().slice(0, 8)}`,
    name: "Repeat Publish Test",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Original",
    body: "Body",
  });

  const firstPub = await actions.publishConsentTemplateVersionAction(draft.id);
  const firstPubTime = new Date(firstPub.publishedAt!).getTime();

  // Wait 10ms to ensure a different time would be generated if mutated
  await new Promise((r) => setTimeout(r, 20));

  const secondPub = await actions.publishConsentTemplateVersionAction(draft.id);
  const secondPubTime = new Date(secondPub.publishedAt!).getTime();

  expect(secondPubTime).toBe(firstPubTime);
});

test("18. Two concurrent draft creations allocate distinct sequential version numbers", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `concurrency_${randomUUID().slice(0, 8)}`,
    name: "Concurrency Test",
  });

  // Launch two concurrent draft creations in parallel transactions
  const p1 = appDb().transaction(async (tx) => {
    return service.createDraftVersion(
      tx,
      { studioId, userId: ownerUserId },
      {
        templateId: template.id,
        title: "Concurrent V1",
        body: "Body 1",
      }
    );
  });

  const p2 = appDb().transaction(async (tx) => {
    return service.createDraftVersion(
      tx,
      { studioId, userId: ownerUserId },
      {
        templateId: template.id,
        title: "Concurrent V2",
        body: "Body 2",
      }
    );
  });

  const [res1, res2] = await Promise.all([p1, p2]);

  const versions = [res1.versionNumber, res2.versionNumber].sort((a, b) => a - b);
  expect(versions).toEqual([1, 2]);
});

test("19. No cross-Studio template-version creation", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `cross_ver_${randomUUID().slice(0, 8)}`,
    name: "Studio 1 Template",
  });

  // Foreign studio tries to create a version for Studio 1's template
  session.studioId = foreignStudioId;
  await expect(
    actions.createConsentTemplateDraftVersionAction({
      templateId: template.id,
      title: "Foreign Version",
      body: "Foreign Body",
    })
  ).rejects.toThrow();
});

test("20. Archived template cannot publish an outstanding draft", async () => {
  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `arch_pub_${randomUUID().slice(0, 8)}`,
    name: "Draft Before Archive",
  });

  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Draft Title",
    body: "Draft Body",
  });

  // Archive the parent template
  await actions.archiveConsentTemplateAction(template.id);

  // Publishing outstanding draft must now fail
  await expect(
    actions.publishConsentTemplateVersionAction(draft.id)
  ).rejects.toThrow(/archived/i);
});

test("21. No cycle rows mutated by template commands", async () => {
  const cyclesBefore = await appDb().select().from(s.treatmentCycles);

  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `cycle_check_${randomUUID().slice(0, 8)}`,
    name: "Cycle Check",
  });
  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Title",
    body: "Body",
  });
  await actions.publishConsentTemplateVersionAction(draft.id);

  const cyclesAfter = await appDb().select().from(s.treatmentCycles);
  expect(cyclesAfter).toEqual(cyclesBefore);
});

test("22. No cycle consent/media rows created by template commands", async () => {
  const consentsBefore = await appDb().select().from(s.cycleConsents);
  const mediaBefore = await appDb().select().from(s.media);

  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `no_side_effects_${randomUUID().slice(0, 8)}`,
    name: "No Side Effects",
  });
  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Title",
    body: "Body",
  });
  await actions.publishConsentTemplateVersionAction(draft.id);

  const consentsAfter = await appDb().select().from(s.cycleConsents);
  const mediaAfter = await appDb().select().from(s.media);

  expect(consentsAfter).toEqual(consentsBefore);
  expect(mediaAfter).toEqual(mediaBefore);
});

test("23. Legacy consents unaffected by template commands", async () => {
  const legacyBefore = await appDb().select().from(s.consents);

  session.studioId = studioId;
  const template = await actions.createConsentTemplateAction({
    code: `legacy_check_${randomUUID().slice(0, 8)}`,
    name: "Legacy Check",
  });
  const draft = await actions.createConsentTemplateDraftVersionAction({
    templateId: template.id,
    title: "Title",
    body: "Body",
  });
  await actions.publishConsentTemplateVersionAction(draft.id);

  const legacyAfter = await appDb().select().from(s.consents);
  expect(legacyAfter).toEqual(legacyBefore);
});

test("24. Idempotency: replay returns previous result; changed payload fails", async () => {
  session.studioId = studioId;
  const requestKey = randomUUID();
  const input = {
    code: `idemp_${randomUUID().slice(0, 8)}`,
    name: "Idempotency Template",
  };

  const res1 = await actions.createConsentTemplateAction(input, requestKey);
  expect(res1.id).toBeDefined();

  // Replay with exact same payload and key returns identical result
  const res2 = await actions.createConsentTemplateAction(input, requestKey);
  expect(res2).toEqual(res1);

  // Replay with same key but different payload fails
  await expect(
    actions.createConsentTemplateAction(
      {
        ...input,
        name: "Different Name",
      },
      requestKey
    )
  ).rejects.toThrow();
});

test("25. Role permissions: MASTER cannot author/publish; CLIENT is rejected", async () => {
  session.studioId = studioId;

  // MASTER cannot create template
  session.id = masterUserId;
  await expect(
    actions.createConsentTemplateAction({
      code: "master_try",
      name: "Master Template",
    })
  ).rejects.toThrow();

  // CLIENT cannot create template
  session.id = clientUserId;
  await expect(
    actions.createConsentTemplateAction({
      code: "client_try",
      name: "Client Template",
    })
  ).rejects.toThrow();
});

test("26. Tenant-safe listing helpers respect studio containment and archive filtering", async () => {
  session.studioId = studioId;
  session.id = ownerUserId;

  const code1 = `list_act_${randomUUID().slice(0, 8)}`;
  const code2 = `list_arch_${randomUUID().slice(0, 8)}`;

  const activeT = await actions.createConsentTemplateAction({
    code: code1,
    name: "Active Template",
  });
  const archT = await actions.createConsentTemplateAction({
    code: code2,
    name: "To Archive Template",
  });
  await actions.archiveConsentTemplateAction(archT.id);

  // list without includeArchived
  const activeList = await queries.listConsentTemplates(studioId, {}, appDb());
  const activeCodes = activeList.map((t) => t.code);
  expect(activeCodes).toContain(code1);
  expect(activeCodes).not.toContain(code2);

  // list with includeArchived: true
  const allList = await queries.listConsentTemplates(
    studioId,
    { includeArchived: true },
    appDb()
  );
  const allCodes = allList.map((t) => t.code);
  expect(allCodes).toContain(code1);
  expect(allCodes).toContain(code2);

  // list versions
  await actions.createConsentTemplateDraftVersionAction({
    templateId: activeT.id,
    title: "Version 1",
    body: "Body 1",
  });
  await actions.createConsentTemplateDraftVersionAction({
    templateId: activeT.id,
    title: "Version 2",
    body: "Body 2",
  });

  const versions = await queries.listConsentTemplateVersions(
    studioId,
    activeT.id,
    appDb()
  );
  expect(versions).toHaveLength(2);
  expect(versions[0].versionNumber).toBe(1);
  expect(versions[1].versionNumber).toBe(2);
});
