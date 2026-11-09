import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
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

describe("Phase 17: Privacy Concurrency & Race Condition Tests", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof import("@/db").db;
  let exportService: typeof import("@/features/privacy/server/export-service");
  let anonymizationService: typeof import("@/features/privacy/server/anonymization-service");

  let studioId: string;
  let ownerUserId: string;
  let clientId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    db = (await import("@/db")).db;
    exportService = await import("@/features/privacy/server/export-service");
    anonymizationService = await import("@/features/privacy/server/anonymization-service");

    [studioId] = (
      await db.insert(s.studios).values(studioFixture()).returning()
    ).map((r) => r.id);

    ownerUserId = randomUUID();
    await db.insert(s.user).values({
      id: ownerUserId,
      name: "Owner",
      email: `owner-${ownerUserId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const rolesList = await db.select().from(s.roles);
    const ownerRole = rolesList.find((r) => r.code === "OWNER")!;

    await db.insert(s.studioMembers).values({
      userId: ownerUserId,
      studioId,
      roleId: ownerRole.id,
      isActive: true,
    });
  });

  beforeEach(async () => {
    session.id = ownerUserId;
    session.studioId = studioId;
    session.role = "OWNER";

    const [c] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Lucia",
        lastName: "Ferrari",
        fullName: "Lucia Ferrari",
        phone: "+393335554433",
        email: "lucia.ferrari@example.test",
        clientStatus: "new_lead",
      })
      .returning();
    clientId = c.id;
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it("1. Concurrent duplicate anonymization executions resolve idempotently without conflict", async () => {
    const p1 = anonymizationService.anonymizeClient(
      studioId,
      clientId,
      ownerUserId,
      "Concurrent Anon 1",
      db as any
    );
    const p2 = anonymizationService.anonymizeClient(
      studioId,
      clientId,
      ownerUserId,
      "Concurrent Anon 2",
      db as any
    );

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.clientId).toBe(clientId);
    expect(r2.clientId).toBe(clientId);

    const [clientRow] = await db.select().from(s.clients).where(eq(s.clients.id, clientId));
    expect(clientRow.fullName).toBe("Anonymized Client");
    expect(clientRow.phone).toBe("+000000000000");
    expect(clientRow.email).toBeNull();
  });

  it("2. Concurrent export generation on the same request is idempotent and creates exactly one artifact", async () => {
    const [req] = await db
      .insert(s.privacyRequests)
      .values({
        studioId,
        clientId,
        requestType: "EXPORT",
        status: "APPROVED",
        requestedById: ownerUserId,
      })
      .returning();

    const p1 = exportService.executePrivacyExport(req.id, studioId, ownerUserId);
    const p2 = exportService.executePrivacyExport(req.id, studioId, ownerUserId);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.exportArtifactId).toBe(r2.exportArtifactId);

    const artifacts = await db.select().from(s.media).where(and(eq(s.media.studioId, studioId), eq(s.media.publicId, `export-${req.id}`)));
    expect(artifacts.length).toBe(1);
  });
});
