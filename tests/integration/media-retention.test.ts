import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import {
  cleanupExpiredPrivacyExports,
  cleanupOrphanMedia,
} from "@/features/privacy/server/retention-service";

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

describe("Phase 17: Media Retention & Safe Orphan Cleanup Integration Tests", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof import("@/db").db;

  let studioId: string;
  let ownerUserId: string;
  let clientId: string;
  let procedureSessionId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    db = (await import("@/db")).db;

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

    const [master] = await db
      .insert(s.masters)
      .values({
        studioId,
        displayName: "Master A",
      })
      .returning();

    const [service] = await db
      .insert(s.services)
      .values({
        studioId,
        name: "PMU Brows",
        procedureType: "brows",
        category: "brows",
        priceCents: 10000,
        durationMinutes: 60,
      })
      .returning();

    const [c] = await db
      .insert(s.clients)
      .values({
        studioId,
        firstName: "Elena",
        lastName: "Bianchi",
        fullName: "Elena Bianchi",
        phone: "+393339998877",
        clientStatus: "new_lead",
      })
      .returning();
    clientId = c.id;

    const [appt] = await db
      .insert(s.appointments)
      .values({
        studioId,
        clientId,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "completed",
        source: "walk_in",
        createdById: ownerUserId,
        serviceSnapshot: { name: "PMU Brows" },
        clientSnapshot: { name: "Elena Bianchi" },
        masterSnapshot: { name: "Master A" },
        priceSnapshotCents: 10000,
        durationSnapshotMinutes: 60,
      })
      .returning();

    const [proc] = await db
      .insert(s.procedureSessions)
      .values({
        studioId,
        clientId,
        appointmentId: appt.id,
        masterId: master.id,
        serviceId: service.id,
        procedureArea: "brows",
        procedureType: "brows",
        sessionType: "primary_session",
      })
      .returning();

    procedureSessionId = proc.id;
  });

  beforeEach(async () => {
    session.id = ownerUserId;
    session.studioId = studioId;
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it("1. Guards active signed consent PDFs and procedure photos against deletion", async () => {
    // 1. Consent media
    const [consentMedia] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "consent",
        url: "https://example.test/consent.pdf",
        publicId: "consent-doc-x",
        caption: "Guarded Consent",
        createdById: ownerUserId,
        deletedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Soft-deleted 30 days ago
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // 2. Procedure before photo
    const [procMedia] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "before",
        url: "https://example.test/before.jpg",
        publicId: "before-photo-x",
        caption: "Procedure Photo",
        createdById: ownerUserId,
        procedureSessionId,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // 3. Genuine unreferenced orphan media (deleted 30 days ago)
    const [orphanMedia] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "other",
        url: "https://example.test/temp.jpg",
        publicId: "temp-orphan",
        createdById: ownerUserId,
        deletedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // Run orphan cleanup with 14 days grace period
    const result = await db.transaction((tx) => cleanupOrphanMedia(studioId, tx, 14));

    expect(result.deletedOrphanMediaCount).toBe(1); // Deleted only orphanMedia
    expect(result.preservedEvidenceCount).toBe(1); // Preserved consentMedia

    // Check consentMedia and procMedia still exist
    const [consentStillExists] = await db.select().from(s.media).where(eq(s.media.id, consentMedia.id));
    expect(consentStillExists).toBeDefined();

    const [procStillExists] = await db.select().from(s.media).where(eq(s.media.id, procMedia.id));
    expect(procStillExists).toBeDefined();

    // Check orphanMedia is permanently removed
    const [orphanStillExists] = await db.select().from(s.media).where(eq(s.media.id, orphanMedia.id));
    expect(orphanStillExists).toBeUndefined();
  });

  it("2. Cleans up expired privacy exports while preserving active ones", async () => {
    // 1. Expired export (expired 2 days ago)
    const [expiredMedia] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "document",
        url: "/api/privacy/export/req-1/download",
        publicId: "export-req-1",
        createdById: ownerUserId,
      })
      .returning();

    const [expiredReq] = await db
      .insert(s.privacyRequests)
      .values({
        studioId,
        clientId,
        requestType: "EXPORT",
        status: "COMPLETED",
        requestedById: ownerUserId,
        exportArtifactId: expiredMedia.id,
        exportExpiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // 2. Active export (expires in 10 days)
    const [activeMedia] = await db
      .insert(s.media)
      .values({
        studioId,
        clientId,
        type: "document",
        url: "/api/privacy/export/req-2/download",
        publicId: "export-req-2",
        createdById: ownerUserId,
      })
      .returning();

    const [activeReq] = await db
      .insert(s.privacyRequests)
      .values({
        studioId,
        clientId,
        requestType: "EXPORT",
        status: "COMPLETED",
        requestedById: ownerUserId,
        exportArtifactId: activeMedia.id,
        exportExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      })
      .returning();

    // Run export cleanup
    const cleanResult = await db.transaction((tx) => cleanupExpiredPrivacyExports(studioId, tx));
    expect(cleanResult.deletedExportMediaCount).toBe(1);

    // Verify expired export media deleted & request unlinked
    const [expiredMediaAfter] = await db.select().from(s.media).where(eq(s.media.id, expiredMedia.id));
    expect(expiredMediaAfter).toBeUndefined();

    const [expiredReqAfter] = await db.select().from(s.privacyRequests).where(eq(s.privacyRequests.id, expiredReq.id));
    expect(expiredReqAfter.exportArtifactId).toBeNull();

    // Verify active export media still intact
    const [activeMediaAfter] = await db.select().from(s.media).where(eq(s.media.id, activeMedia.id));
    expect(activeMediaAfter).toBeDefined();

    const [activeReqAfter] = await db.select().from(s.privacyRequests).where(eq(s.privacyRequests.id, activeReq.id));
    expect(activeReqAfter.exportArtifactId).toBe(activeMedia.id);
  });
});
