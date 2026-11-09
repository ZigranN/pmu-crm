import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import { studioFixture, clientFixture } from "../fixtures/studio";
import * as s from "@/db/schema";
import { NextRequest } from "next/server";

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));

const cookieState = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        sessionState.user ? { user: sessionState.user } : null,
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === "pmu_active_studio" && cookieState.value !== undefined
        ? { name: "pmu_active_studio", value: cookieState.value }
        : undefined,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Protected Media & Consent Delivery Architecture (Phase 1.3B)", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof database.db;

  let ownerUser: string;
  let masterUserA: string;
  let masterUserB: string;
  let noPermUser: string;

  let studioA: string;
  let studioB: string;

  let masterRecordA: string;
  let masterRecordB: string;

  let clientA: string; // assigned to Master A
  let clientB: string; // assigned to Master B

  let clinicalMediaA: string;
  let clinicalMediaB: string;
  let consentDocPdf: string;
  let consentDocImage: string;
  let softDeletedMedia: string;
  let authClinicalMediaA: string;
  let authConsentDocPdf: string;
  let unclassifiableMediaA: string;
  let permissionsMap: Map<string, string>;

  let GET: typeof import("@/app/api/media/[id]/content/route").GET;
  let getClientMediaAction: typeof import("@/features/media/server/actions").getClientMediaAction;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
    vi.doMock("@/db", () => ({ db }));

    const routeModule = await import("@/app/api/media/[id]/content/route");
    GET = routeModule.GET;

    const mediaActions = await import("@/features/media/server/actions");
    getClientMediaAction = mediaActions.getClientMediaAction;

    // Mock global fetch for upstream Cloudinary streaming
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("pdf") || url.includes("raw/upload") || url.includes("consent-pdf")) {
          return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-length": "4",
            },
          });
        }
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": "4",
          },
        });
      })
    );

    // Seed Studios
    [studioA, studioB] = (
      await db
        .insert(s.studios)
        .values([studioFixture(), studioFixture()])
        .returning()
    ).map((r) => r.id);

    // Seed Users
    ownerUser = randomUUID();
    masterUserA = randomUUID();
    masterUserB = randomUUID();
    noPermUser = randomUUID();

    await db.insert(s.user).values(
      [ownerUser, masterUserA, masterUserB, noPermUser].map((id) => ({
        id,
        name: `User-${id.slice(0, 8)}`,
        email: `${id}@test.local`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    // Seed Roles & Studio Memberships
    const rolesMap = new Map<string, string>();
    for (const r of await db.select().from(s.roles)) {
      rolesMap.set(r.code, r.id);
    }

    permissionsMap = new Map<string, string>();
    for (const p of await db.select().from(s.permissions)) {
      permissionsMap.set(p.code, p.id);
    }

    const [customRole] = await db
      .insert(s.roles)
      .values({
        code: `GUEST_LIMITED_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
        name: "Guest Limited",
        description: "No media permissions",
        isSystem: false,
      })
      .returning();

    await db.insert(s.studioMembers).values([
      { studioId: studioA, userId: ownerUser, roleId: rolesMap.get("OWNER")!, isActive: true },
      { studioId: studioA, userId: masterUserA, roleId: rolesMap.get("MASTER")!, isActive: true },
      { studioId: studioA, userId: masterUserB, roleId: rolesMap.get("MASTER")!, isActive: true },
      { studioId: studioA, userId: noPermUser, roleId: customRole.id, isActive: true },
      // studioB membership for isolation test
      { studioId: studioB, userId: masterUserB, roleId: rolesMap.get("MASTER")!, isActive: true },
    ]);

    // Seed Master Profiles
    [masterRecordA, masterRecordB] = (
      await db
        .insert(s.masters)
        .values([
          { studioId: studioA, userId: masterUserA, displayName: "Master A" },
          { studioId: studioA, userId: masterUserB, displayName: "Master B" },
        ])
        .returning()
    ).map((r) => r.id);

    // Seed Clients
    [clientA, clientB] = (
      await db
        .insert(s.clients)
        .values([
          { ...clientFixture(studioA), assignedMasterId: masterRecordA },
          { ...clientFixture(studioA), assignedMasterId: masterRecordB },
        ])
        .returning()
    ).map((r) => r.id);

    // Seed Media Records
    const [mediaA, mediaB, consentPdf, consentImg, deletedM, authMediaA, authDocPdf, unclassM] = await db
      .insert(s.media)
      .values([
        {
          studioId: studioA,
          clientId: clientA,
          type: "before",
          url: "https://res.cloudinary.com/crm-pmu/image/upload/v1/clientA-before.jpg",
          publicId: `crm-pmu/${studioA}/before/asset-a`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientB,
          type: "after",
          url: "https://res.cloudinary.com/crm-pmu/image/upload/v1/clientB-after.jpg",
          publicId: `crm-pmu/${studioA}/after/asset-b`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "consent",
          url: "https://res.cloudinary.com/crm-pmu/raw/upload/v1/consent-pdf.pdf",
          publicId: `crm-pmu/${studioA}/consent/consent-pdf`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "consent",
          url: "https://res.cloudinary.com/crm-pmu/image/upload/v1/consent-img.jpg",
          publicId: `crm-pmu/${studioA}/consent/consent-img`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "before",
          url: "https://res.cloudinary.com/crm-pmu/image/upload/v1/deleted.jpg",
          publicId: `crm-pmu/${studioA}/before/deleted`,
          createdById: ownerUser,
          deletedAt: new Date(),
          deletedById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "before",
          url: "https://res.cloudinary.com/crm-pmu/image/authenticated/s--sig1--/v1/clientA-auth-before.jpg",
          publicId: `crm-pmu/${studioA}/before/auth-asset-a`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "consent",
          url: "https://res.cloudinary.com/crm-pmu/raw/authenticated/s--sig2--/v1/auth-consent-pdf.pdf",
          publicId: `crm-pmu/${studioA}/consent/auth-consent-pdf`,
          createdById: ownerUser,
        },
        {
          studioId: studioA,
          clientId: clientA,
          type: "before",
          url: "https://unknown-cdn.example.com/arbitrary/unclassifiable.jpg",
          publicId: `crm-pmu/${studioA}/before/unclassifiable`,
          createdById: ownerUser,
        },
      ])
      .returning();

    clinicalMediaA = mediaA.id;
    clinicalMediaB = mediaB.id;
    consentDocPdf = consentPdf.id;
    consentDocImage = consentImg.id;
    softDeletedMedia = deletedM.id;
    authClinicalMediaA = authMediaA.id;
    authConsentDocPdf = authDocPdf.id;
    unclassifiableMediaA = unclassM.id;

    // Seed Consent entries
    await db.insert(s.consents).values([
      {
        studioId: studioA,
        clientId: clientA,
        mediaId: consentDocPdf,
        consentType: "pmu_general",
        signedAt: new Date(),
      },
      {
        studioId: studioA,
        clientId: clientA,
        mediaId: consentDocImage,
        consentType: "photo_permission",
        signedAt: new Date(),
      },
      {
        studioId: studioA,
        clientId: clientA,
        mediaId: authConsentDocPdf,
        consentType: "pmu_general",
        signedAt: new Date(),
      },
    ]);
  });

  beforeEach(() => {
    sessionState.user = { id: ownerUser };
    cookieState.value = studioA;
  });

  describe("1. Unauthenticated and Invalid Session Access", () => {
    it("returns 401 Unauthorized when session is missing", async () => {
      sessionState.user = null;
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 403 Forbidden when active studio cookie is missing", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = undefined;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(403);
    });

    it("returns 404 Not Found for non-UUID mediaId", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        "http://localhost/api/media/invalid-uuid/content"
      );
      const res = await GET(req, { params: Promise.resolve({ id: "invalid-uuid" }) });

      expect(res.status).toBe(404);
    });
  });

  describe("2. Studio Isolation and Cross-Tenant Boundaries", () => {
    it("returns 404 Not Found when attempting to access Studio A media from Studio B context", async () => {
      // User is member of both studios, but currently in Studio B context
      sessionState.user = { id: masterUserB };
      cookieState.value = studioB;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(404);
    });
  });

  describe("3. Master Scope Enforcement (Client Privacy Boundary)", () => {
    it("allows Master A to read media of assigned Client A", async () => {
      sessionState.user = { id: masterUserA };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(200);
    });

    it("returns 404 Not Found when Master A attempts to access media of Client B (assigned to Master B)", async () => {
      sessionState.user = { id: masterUserA };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaB}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaB }) });

      expect(res.status).toBe(404);
    });

    it("allows Owner to access any client media in the active studio", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const reqA = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const resA = await GET(reqA, { params: Promise.resolve({ id: clinicalMediaA }) });
      expect(resA.status).toBe(200);

      const reqB = new NextRequest(
        `http://localhost/api/media/${clinicalMediaB}/content`
      );
      const resB = await GET(reqB, { params: Promise.resolve({ id: clinicalMediaB }) });
      expect(resB.status).toBe(200);
    });
  });

  describe("4. Permission Enforcement & Immediate Revocation", () => {
    it("returns 403 Forbidden for a user without MEDIA_READ permission", async () => {
      sessionState.user = { id: noPermUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(403);
    });

    it("returns 403 Forbidden when a custom DENY rule is set on MEDIA_READ", async () => {
      const mediaReadPermId = permissionsMap.get("MEDIA_READ")!;
      await db.insert(s.userCustomPermissions).values({
        studioId: studioA,
        userId: masterUserA,
        permissionId: mediaReadPermId,
        effect: "deny",
      });

      sessionState.user = { id: masterUserA };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(403);

      // Clean up custom permission
      await db
        .delete(s.userCustomPermissions)
        .where(
          and(
            eq(s.userCustomPermissions.studioId, studioA),
            eq(s.userCustomPermissions.userId, masterUserA)
          )
        );
    });

    it("returns 403 Forbidden when a custom DENY rule is set on CONSENT_READ", async () => {
      const consentReadPermId = permissionsMap.get("CONSENT_READ")!;
      await db.insert(s.userCustomPermissions).values({
        studioId: studioA,
        userId: masterUserA,
        permissionId: consentReadPermId,
        effect: "deny",
      });

      sessionState.user = { id: masterUserA };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${consentDocPdf}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: consentDocPdf }) });

      expect(res.status).toBe(403);

      // Clean up custom permission
      await db
        .delete(s.userCustomPermissions)
        .where(
          and(
            eq(s.userCustomPermissions.studioId, studioA),
            eq(s.userCustomPermissions.userId, masterUserA)
          )
        );
    });

    it("immediately denies access (403) when user studio membership is deactivated", async () => {
      // Deactivate Master A's membership in Studio A
      await db
        .update(s.studioMembers)
        .set({ isActive: false })
        .where(
          and(
            eq(s.studioMembers.userId, masterUserA),
            eq(s.studioMembers.studioId, studioA)
          )
        );

      sessionState.user = { id: masterUserA };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(403);

      // Restore membership for subsequent tests
      await db
        .update(s.studioMembers)
        .set({ isActive: true })
        .where(
          and(
            eq(s.studioMembers.userId, masterUserA),
            eq(s.studioMembers.studioId, studioA)
          )
        );
    });
  });

  describe("5. Soft-Deleted / Archived Media Protection", () => {
    it("returns 404 Not Found for archived media records", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${softDeletedMedia}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: softDeletedMedia }) });

      expect(res.status).toBe(404);
    });
  });

  describe("6. Cache-Control and Security Response Headers", () => {
    it("emits strict Cache-Control: private, no-store and nosniff headers for clinical images", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(
        "private, no-store, max-age=0, must-revalidate"
      );
      expect(res.headers.get("Pragma")).toBe("no-cache");
      expect(res.headers.get("Expires")).toBe("0");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Content-Disposition")).toBe(
        `inline; filename="before-${clinicalMediaA}.jpg"`
      );
    });

    it("serves PDF consent records with Content-Type: application/pdf and inline disposition", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${consentDocPdf}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: consentDocPdf }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toBe(
        `inline; filename="consent-${consentDocPdf}.pdf"`
      );
      expect(res.headers.get("Cache-Control")).toBe(
        "private, no-store, max-age=0, must-revalidate"
      );
    });

    it("supports authenticated download disposition via ?download=1", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const req = new NextRequest(
        `http://localhost/api/media/${consentDocPdf}/content?download=1`
      );
      const res = await GET(req, { params: Promise.resolve({ id: consentDocPdf }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(
        `attachment; filename="consent-${consentDocPdf}.pdf"`
      );
    });
  });

  describe("7. Public Provider URL Suppression in Metadata APIs", () => {
    it("returns internal proxy endpoints and never exposes raw Cloudinary URLs in getClientMediaAction", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const mediaItems = await getClientMediaAction(clientA, "media");
      expect(mediaItems.length).toBeGreaterThan(0);

      for (const item of mediaItems) {
        expect(item.url).toBe(`/api/media/${item.id}/content`);
        expect(item.url).not.toContain("res.cloudinary.com");
      }

      const consentItems = await getClientMediaAction(clientA, "consent");
      expect(consentItems.length).toBeGreaterThan(0);

      for (const item of consentItems) {
        expect(item.url).toBe(`/api/media/${item.id}/content`);
        expect(item.url).not.toContain("res.cloudinary.com");
      }
    });
  });

  describe("8. Evidentiary Access Logging", () => {
    it("records returned accessLogs entry on successful media fetch and denied on unauthorized attempt", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const reqSuccess = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      await GET(reqSuccess, { params: Promise.resolve({ id: clinicalMediaA }) });

      const successLogs = await db
        .select()
        .from(s.accessLogs)
        .where(
          and(
            eq(s.accessLogs.studioId, studioA),
            eq(s.accessLogs.targetId, clinicalMediaA),
            eq(s.accessLogs.actorId, ownerUser)
          )
        );

      expect(successLogs.length).toBeGreaterThan(0);
      expect(successLogs.some((l) => l.result === "returned")).toBe(true);

      // Attempt by user without permission
      sessionState.user = { id: noPermUser };
      cookieState.value = studioA;

      const reqDenied = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      await GET(reqDenied, { params: Promise.resolve({ id: clinicalMediaA }) });

      const deniedLogs = await db
        .select()
        .from(s.accessLogs)
        .where(
          and(
            eq(s.accessLogs.studioId, studioA),
            eq(s.accessLogs.targetId, clinicalMediaA),
            eq(s.accessLogs.actorId, noPermUser)
          )
        );

      expect(deniedLogs.length).toBeGreaterThan(0);
      expect(deniedLogs.some((l) => l.result === "denied")).toBe(true);
    });
  });

  describe("9. Forward-Looking Authenticated Provider Delivery & Backward Compatibility (Phase 1.3C2A)", () => {
    it("fetches legacy /image/upload/ record using legacy upload URL", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const req = new NextRequest(
        `http://localhost/api/media/${clinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: clinicalMediaA }) });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://res.cloudinary.com/crm-pmu/image/upload/v1/clientA-before.jpg"
      );
    });

    it("fetches legacy /raw/upload/ PDF record using legacy upload URL and delivers application/pdf", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const req = new NextRequest(
        `http://localhost/api/media/${consentDocPdf}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: consentDocPdf }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://res.cloudinary.com/crm-pmu/raw/upload/v1/consent-pdf.pdf"
      );
    });

    it("fetches authenticated image record via server-generated signed provider URL", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const { getSignedCloudinaryDeliveryUrl } = await import("@/lib/cloudinary");
      const signedUrlMock = vi.mocked(getSignedCloudinaryDeliveryUrl);
      signedUrlMock.mockClear();

      const req = new NextRequest(
        `http://localhost/api/media/${authClinicalMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: authClinicalMediaA }) });

      expect(res.status).toBe(200);
      expect(signedUrlMock).toHaveBeenCalledWith(
        `crm-pmu/${studioA}/before/auth-asset-a`,
        { resource_type: "image" }
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/image/authenticated/")
      );
    });

    it("fetches authenticated raw PDF consent via server-generated signed provider URL and delivers application/pdf", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const { getSignedCloudinaryDeliveryUrl } = await import("@/lib/cloudinary");
      const signedUrlMock = vi.mocked(getSignedCloudinaryDeliveryUrl);
      signedUrlMock.mockClear();

      const req = new NextRequest(
        `http://localhost/api/media/${authConsentDocPdf}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: authConsentDocPdf }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(signedUrlMock).toHaveBeenCalledWith(
        `crm-pmu/${studioA}/consent/auth-consent-pdf`,
        { resource_type: "raw" }
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/raw/authenticated/")
      );
    });

    it("fails closed (500) and executes zero provider fetch for unclassifiable URL", async () => {
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const req = new NextRequest(
        `http://localhost/api/media/${unclassifiableMediaA}/content`
      );
      const res = await GET(req, { params: Promise.resolve({ id: unclassifiableMediaA }) });

      expect(res.status).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("guarantees zero provider fetch and zero signed URL generation on denied requests", async () => {
      const fetchMock = vi.mocked(fetch);
      const { getSignedCloudinaryDeliveryUrl } = await import("@/lib/cloudinary");
      const signedUrlMock = vi.mocked(getSignedCloudinaryDeliveryUrl);

      // Case 1: Foreign studio context
      fetchMock.mockClear();
      signedUrlMock.mockClear();
      sessionState.user = { id: masterUserB };
      cookieState.value = studioB;
      const res1 = await GET(
        new NextRequest(`http://localhost/api/media/${authClinicalMediaA}/content`),
        { params: Promise.resolve({ id: authClinicalMediaA }) }
      );
      expect(res1.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(signedUrlMock).not.toHaveBeenCalled();

      // Case 2: Master outside client scope
      fetchMock.mockClear();
      signedUrlMock.mockClear();
      sessionState.user = { id: masterUserB };
      cookieState.value = studioA;
      const res2 = await GET(
        new NextRequest(`http://localhost/api/media/${authClinicalMediaA}/content`),
        { params: Promise.resolve({ id: authClinicalMediaA }) }
      );
      expect(res2.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(signedUrlMock).not.toHaveBeenCalled();

      // Case 3: User without permissions
      fetchMock.mockClear();
      signedUrlMock.mockClear();
      sessionState.user = { id: noPermUser };
      cookieState.value = studioA;
      const res3 = await GET(
        new NextRequest(`http://localhost/api/media/${authClinicalMediaA}/content`),
        { params: Promise.resolve({ id: authClinicalMediaA }) }
      );
      expect(res3.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(signedUrlMock).not.toHaveBeenCalled();

      // Case 4: Archived media
      fetchMock.mockClear();
      signedUrlMock.mockClear();
      sessionState.user = { id: ownerUser };
      cookieState.value = studioA;
      const res4 = await GET(
        new NextRequest(`http://localhost/api/media/${softDeletedMedia}/content`),
        { params: Promise.resolve({ id: softDeletedMedia }) }
      );
      expect(res4.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(signedUrlMock).not.toHaveBeenCalled();
    });
  });
});
