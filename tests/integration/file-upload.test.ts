import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "../support/database";
import {
  studioFixture,
  clientFixture,
  VALID_PNG_BYTES,
  VALID_PDF_BYTES,
  testImageFile,
  testPdfFile,
} from "../fixtures/studio";
import * as s from "@/db/schema";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
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

describe("Upload Security and Authorization Contract (Phase 1.2)", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: typeof database.db;
  let userA: string;
  let userB: string;
  let userRestricted: string;
  let studioA: string;
  let studioB: string;
  let clientA: string;
  let clientB: string;
  let roleId: string;
  let restrictedRoleId: string;
  let appointmentB: string;
  let procedureSessionB: string;
  let masterUpdatePermId: string;

  let imageRoute: typeof import("@/app/api/upload/image/route");
  let mediaActions: typeof import("@/features/media/server/actions");
  let consentActions: typeof import("@/features/consent/server/actions");

  beforeAll(async () => {
    database = await createTestDatabase();
    vi.doMock("@/db", () => ({ db: database.db }));
    db = (await import("@/db")).db;

    imageRoute = await import("@/app/api/upload/image/route");
    mediaActions = await import("@/features/media/server/actions");
    consentActions = await import("@/features/consent/server/actions");

    userA = randomUUID();
    userB = randomUUID();
    userRestricted = randomUUID();

    const [stA, stB] = await db
      .insert(s.studios)
      .values([studioFixture(), studioFixture()])
      .returning();
    studioA = stA.id;
    studioB = stB.id;

    await db.insert(s.user).values([
      {
        id: userA,
        name: "User A",
        email: `${userA}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userB,
        name: "User B",
        email: `${userB}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userRestricted,
        name: "User Restricted",
        email: `${userRestricted}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const [role, restrictedRole] = await db
      .insert(s.roles)
      .values([
        { code: `UPLOAD_TESTER_${randomUUID()}`, name: "Upload Tester" },
        { code: `RESTRICTED_TESTER_${randomUUID()}`, name: "Restricted Tester" },
      ])
      .returning();
    roleId = role.id;
    restrictedRoleId = restrictedRole.id;

    const permissions = [
      "MEDIA_CREATE",
      "MEDIA_READ",
      "CONSENT_UPLOAD",
      "CONSENT_READ",
      "CLIENT_UPDATE",
      "SETTINGS_UPDATE",
      "MASTER_UPDATE",
      "MASTER_CREATE",
    ];

    await db
      .insert(s.permissions)
      .values(permissions.map((code) => ({ code, name: code })))
      .onConflictDoNothing()
      .returning();

    const allPerms = await db.select().from(s.permissions);
    const neededPerms = allPerms.filter((p) => permissions.includes(p.code));
    masterUpdatePermId = allPerms.find((p) => p.code === "MASTER_UPDATE")!.id;

    await db.insert(s.rolePermissions).values(
      neededPerms.map((p) => ({
        roleId,
        permissionId: p.id,
      }))
    );

    // restricted role only gets CLIENT_UPDATE, no MASTER_UPDATE or SETTINGS_UPDATE
    const clientUpdatePerm = allPerms.find((p) => p.code === "CLIENT_UPDATE")!;
    await db.insert(s.rolePermissions).values({
      roleId: restrictedRoleId,
      permissionId: clientUpdatePerm.id,
    });

    await db.insert(s.studioMembers).values([
      { studioId: studioA, userId: userA, roleId, isActive: true },
      { studioId: studioB, userId: userB, roleId, isActive: true },
      { studioId: studioA, userId: userRestricted, roleId: restrictedRoleId, isActive: true },
    ]);

    const [clA] = await db
      .insert(s.clients)
      .values(clientFixture(studioA))
      .returning();
    const [clB] = await db
      .insert(s.clients)
      .values(clientFixture(studioB))
      .returning();
    clientA = clA.id;
    clientB = clB.id;

    appointmentB = randomUUID();
    procedureSessionB = randomUUID();
  });

  beforeEach(() => {
    sessionState.user = { id: userA };
    cookieState.value = studioA;
    vi.mocked(uploadToCloudinary)
      .mockReset()
      .mockImplementation(async (_file, options) => ({
        url: `https://cloudinary.example.com/${options.folder}/asset-${randomUUID()}`,
        publicId: `public-${randomUUID()}`,
      }));
    vi.mocked(deleteFromCloudinary).mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  describe("1. Generic Image Upload Route (/api/upload/image)", () => {
    it("rejects unauthenticated requests with 401", async () => {
      sessionState.user = null;
      cookieState.value = undefined;

      const formData = new FormData();
      formData.append("file", testImageFile());
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(401);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects requests with missing active studio cookie with 403", async () => {
      sessionState.user = { id: userA };
      cookieState.value = undefined;

      const formData = new FormData();
      formData.append("file", testImageFile());
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(403);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects requests with stale/invalid active studio cookie with 403", async () => {
      sessionState.user = { id: userA };
      cookieState.value = studioB; // userA is not a member of studioB

      const formData = new FormData();
      formData.append("file", testImageFile());
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(403);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects missing purpose with 400", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile());
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("purpose");
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects invalid/unknown purpose with 400", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile());
      formData.append("purpose", "arbitrary_custom_purpose");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("purpose");
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects upload when user lacks required capability permission for purpose with 403", async () => {
      sessionState.user = { id: userRestricted };
      cookieState.value = studioA;

      const formData = new FormData();
      formData.append("file", testImageFile());
      formData.append("purpose", "master_photo"); // requires MASTER_UPDATE
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(403);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects upload when user has custom DENY override on mapped permission with 403", async () => {
      sessionState.user = { id: userA };
      cookieState.value = studioA;

      // Insert custom DENY for MASTER_UPDATE
      const [override] = await db
        .insert(s.userCustomPermissions)
        .values({
          userId: userA,
          studioId: studioA,
          permissionId: masterUpdatePermId,
          effect: "deny",
        })
        .returning();

      try {
        const formData = new FormData();
        formData.append("file", testImageFile());
        formData.append("purpose", "master_photo");
        const req = new NextRequest("http://localhost/api/upload/image", {
          method: "POST",
          body: formData,
        });

        const res = await imageRoute.POST(req);
        expect(res.status).toBe(403);
        expect(uploadToCloudinary).not.toHaveBeenCalled();
      } finally {
        await db
          .delete(s.userCustomPermissions)
          .where(eq(s.userCustomPermissions.id, override.id));
      }
    });

    it("rejects missing file with 400", async () => {
      const formData = new FormData();
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(400);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("enforces exact 5MB boundary on generic upload: 5,242,880 bytes allowed, 5,242,881 bytes rejected", async () => {
      const exactLimit = 5 * 1024 * 1024; // 5,242,880
      const exactBuffer = Buffer.concat([
        Buffer.from(VALID_PNG_BYTES),
        Buffer.alloc(exactLimit - VALID_PNG_BYTES.length),
      ]);
      const exactFile = new File([exactBuffer], "exact-5mb.png", { type: "image/png" });

      const allowedFormData = new FormData();
      allowedFormData.append("file", exactFile);
      allowedFormData.append("purpose", "master_photo");
      const allowedReq = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: allowedFormData,
      });

      const allowedRes = await imageRoute.POST(allowedReq);
      expect(allowedRes.status).toBe(200);
      expect(uploadToCloudinary).toHaveBeenCalledTimes(1);

      vi.mocked(uploadToCloudinary).mockClear();

      const overBuffer = Buffer.concat([exactBuffer, Buffer.alloc(1)]);
      const overFile = new File([overBuffer], "over-5mb.png", { type: "image/png" });

      const overFormData = new FormData();
      overFormData.append("file", overFile);
      overFormData.append("purpose", "master_photo");
      const overReq = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: overFormData,
      });

      const overRes = await imageRoute.POST(overReq);
      expect(overRes.status).toBe(400);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects MIME-spoofed text file disguised as JPEG with 400", async () => {
      const spoofedFile = new File(["<script>alert('xss')</script>"], "photo.jpg", {
        type: "image/jpeg",
      });

      const formData = new FormData();
      formData.append("file", spoofedFile);
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(400);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects SVG file uploads with 400", async () => {
      const svgFile = new File(
        ["<svg xmlns='http://www.w3.org/2000/svg'><circle r='10'/></svg>"],
        "vector.svg",
        { type: "image/svg+xml" }
      );

      const formData = new FormData();
      formData.append("file", svgFile);
      formData.append("purpose", "studio_logo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(400);
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("uploads valid image for purpose: master_photo to crm-pmu/${studioId}/masters with explicit resource_type: image and type: upload", async () => {
      const validFile = testImageFile("master.png");

      const formData = new FormData();
      formData.append("file", validFile);
      formData.append("purpose", "master_photo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toContain(`crm-pmu/${studioA}/masters`);
      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/masters`,
          resource_type: "image",
          type: "upload",
        })
      );
    });

    it("uploads valid image for purpose: studio_logo to crm-pmu/${studioId}/studio with explicit resource_type: image and type: upload", async () => {
      const validFile = testImageFile("logo.png");

      const formData = new FormData();
      formData.append("file", validFile);
      formData.append("purpose", "studio_logo");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toContain(`crm-pmu/${studioA}/studio`);
      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/studio`,
          resource_type: "image",
          type: "upload",
        })
      );
    });

    it("uploads valid image for purpose: profile_image to crm-pmu/${studioId}/profiles with explicit resource_type: image and type: upload", async () => {
      const validFile = testImageFile("profile.png");

      const formData = new FormData();
      formData.append("file", validFile);
      formData.append("purpose", "profile_image");
      const req = new NextRequest("http://localhost/api/upload/image", {
        method: "POST",
        body: formData,
      });

      const res = await imageRoute.POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toContain(`crm-pmu/${studioA}/profiles`);
      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/profiles`,
          resource_type: "image",
          type: "upload",
        })
      );
    });
  });

  describe("2. Domain Clinical Media Upload (uploadMediaAction)", () => {
    it("rejects cross-tenant upload targeting foreign Client B in Studio A context", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile("before.png"));
      formData.append("clientId", clientB);
      formData.append("type", "before");

      await expect(mediaActions.uploadMediaAction(formData)).rejects.toThrow(
        "Client not found"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects cross-tenant upload with foreign appointment ID", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile("before.png"));
      formData.append("clientId", clientA);
      formData.append("appointmentId", appointmentB); // appointment of studioB
      formData.append("type", "before");

      await expect(mediaActions.uploadMediaAction(formData)).rejects.toThrow(
        "Appointment not found"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects cross-tenant upload with foreign procedureSession ID", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile("before.png"));
      formData.append("clientId", clientA);
      formData.append("procedureSessionId", procedureSessionB); // session of studioB
      formData.append("type", "before");

      await expect(mediaActions.uploadMediaAction(formData)).rejects.toThrow(
        "Procedure session not found"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("enforces exact 10MB boundary on media: 10,485,760 bytes allowed, 10,485,761 bytes rejected", async () => {
      const exactLimit = 10 * 1024 * 1024; // 10,485,760
      const exactBuffer = Buffer.concat([
        Buffer.from(VALID_PNG_BYTES),
        Buffer.alloc(exactLimit - VALID_PNG_BYTES.length),
      ]);
      const exactFile = new File([exactBuffer], "exact-10mb.png", { type: "image/png" });

      const allowedFormData = new FormData();
      allowedFormData.append("file", exactFile);
      allowedFormData.append("clientId", clientA);
      allowedFormData.append("type", "after");

      const created = await mediaActions.uploadMediaAction(allowedFormData);
      expect(created.id).toBeDefined();
      expect(uploadToCloudinary).toHaveBeenCalledTimes(1);

      vi.mocked(uploadToCloudinary).mockClear();

      const overBuffer = Buffer.concat([exactBuffer, Buffer.alloc(1)]);
      const overFile = new File([overBuffer], "over-10mb.png", { type: "image/png" });

      const overFormData = new FormData();
      overFormData.append("file", overFile);
      overFormData.append("clientId", clientA);
      overFormData.append("type", "after");

      await expect(mediaActions.uploadMediaAction(overFormData)).rejects.toThrow(
        /File too large/
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("accepts valid JPEG with application/octet-stream MIME type (MIME is non-authoritative)", async () => {
      const octetStreamFile = testImageFile("photo.bin", "application/octet-stream");

      const formData = new FormData();
      formData.append("file", octetStreamFile);
      formData.append("clientId", clientA);
      formData.append("type", "before");

      const created = await mediaActions.uploadMediaAction(formData);
      expect(created.id).toBeDefined();
      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/before`,
          resource_type: "image",
          type: "authenticated",
        })
      );
    });

    it("accepts valid HEIC clinical media with resource_type: image", async () => {
      const heicBytes = Buffer.from([
        0x00, 0x00, 0x00, 0x18,
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x68, 0x65, 0x69, 0x63, // heic
        0x00, 0x00, 0x00, 0x00,
      ]);
      const heicFile = new File([heicBytes], "procedure.heic", { type: "image/heic" });

      const formData = new FormData();
      formData.append("file", heicFile);
      formData.append("clientId", clientA);
      formData.append("type", "before");

      const created = await mediaActions.uploadMediaAction(formData);
      expect(created.id).toBeDefined();
      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/before`,
          resource_type: "image",
          type: "authenticated",
        })
      );
    });

    it("rejects non-image disguised media files before provider call", async () => {
      const spoofed = new File(["not an image"], "fake.png", {
        type: "image/png",
      });

      const formData = new FormData();
      formData.append("file", spoofed);
      formData.append("clientId", clientA);
      formData.append("type", "before");

      await expect(mediaActions.uploadMediaAction(formData)).rejects.toThrow(
        "Invalid file content: unrecognized file signature"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects PDF files on clinical procedure media endpoints", async () => {
      const pdf = testPdfFile();

      const formData = new FormData();
      formData.append("file", pdf);
      formData.append("clientId", clientA);
      formData.append("type", "before");

      await expect(mediaActions.uploadMediaAction(formData)).rejects.toThrow(
        /Unsupported file format \(pdf\)/
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("successfully uploads clinical media and persists database records", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile("after.png"));
      formData.append("clientId", clientA);
      formData.append("type", "after");
      formData.append("caption", "Healed brows");

      const created = await mediaActions.uploadMediaAction(formData);
      expect(created.id).toBeDefined();
      expect(created.type).toBe("after");
      expect(created.studioId).toBe(studioA);
      expect(created.clientId).toBe(clientA);

      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/after`,
          resource_type: "image",
          type: "authenticated",
        })
      );

      const [dbRow] = await db
        .select()
        .from(s.media)
        .where(eq(s.media.id, created.id));
      expect(dbRow).toBeDefined();
      expect(dbRow.studioId).toBe(studioA);
    });
  });

  describe("3. Consent Document Upload (uploadConsentAction)", () => {
    it("rejects cross-tenant consent upload targeting Client B in Studio A context", async () => {
      const formData = new FormData();
      formData.append("file", testPdfFile());
      formData.append("clientId", clientB);
      formData.append("consentType", "pmu_general");

      await expect(consentActions.uploadConsentAction(formData)).rejects.toThrow(
        "Client not found"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("enforces exact 10MB boundary on consent documents: 10,485,760 bytes allowed, 10,485,761 bytes rejected", async () => {
      const exactLimit = 10 * 1024 * 1024; // 10,485,760
      const exactBuffer = Buffer.concat([
        Buffer.from(VALID_PDF_BYTES),
        Buffer.alloc(exactLimit - VALID_PDF_BYTES.length),
      ]);
      const exactPdf = new File([exactBuffer], "exact-consent.pdf", {
        type: "application/pdf",
      });

      const allowedFormData = new FormData();
      allowedFormData.append("file", exactPdf);
      allowedFormData.append("clientId", clientA);
      allowedFormData.append("consentType", "pmu_general");

      const created = await consentActions.uploadConsentAction(allowedFormData);
      expect(created.id).toBeDefined();
      expect(uploadToCloudinary).toHaveBeenCalledTimes(1);

      vi.mocked(uploadToCloudinary).mockClear();

      const overBuffer = Buffer.concat([exactBuffer, Buffer.alloc(1)]);
      const overPdf = new File([overBuffer], "over-consent.pdf", {
        type: "application/pdf",
      });

      const overFormData = new FormData();
      overFormData.append("file", overPdf);
      overFormData.append("clientId", clientA);
      overFormData.append("consentType", "pmu_general");

      await expect(consentActions.uploadConsentAction(overFormData)).rejects.toThrow(
        /File too large/
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("rejects spoofed non-PDF files disguised as PDF", async () => {
      const spoofed = new File(["plain text consent"], "consent.pdf", {
        type: "application/pdf",
      });

      const formData = new FormData();
      formData.append("file", spoofed);
      formData.append("clientId", clientA);
      formData.append("consentType", "pmu_general");

      await expect(consentActions.uploadConsentAction(formData)).rejects.toThrow(
        "Invalid file content: unrecognized file signature"
      );
      expect(uploadToCloudinary).not.toHaveBeenCalled();
    });

    it("successfully uploads PDF consent with resource_type: raw and type: authenticated and persists consent record", async () => {
      const formData = new FormData();
      formData.append("file", testPdfFile());
      formData.append("clientId", clientA);
      formData.append("consentType", "pmu_general");

      const created = await consentActions.uploadConsentAction(formData);
      expect(created.id).toBeDefined();
      expect(created.consentType).toBe("pmu_general");
      expect(created.studioId).toBe(studioA);

      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/consent`,
          resource_type: "raw",
          type: "authenticated",
        })
      );
    });

    it("successfully uploads photo consent scan (JPEG/PNG) with resource_type: image and type: authenticated", async () => {
      const formData = new FormData();
      formData.append("file", testImageFile("signed-waiver.jpg", "image/jpeg"));
      formData.append("clientId", clientA);
      formData.append("consentType", "photo_permission");

      const created = await consentActions.uploadConsentAction(formData);
      expect(created.id).toBeDefined();
      expect(created.consentType).toBe("photo_permission");

      expect(uploadToCloudinary).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          folder: `crm-pmu/${studioA}/consent`,
          resource_type: "image",
          type: "authenticated",
        })
      );
    });
  });

  describe("4. Compensation Rollback on Database Persistence Failure", () => {
    it("calls deleteFromCloudinary with resource_type and type: authenticated when database persistence fails after provider upload", async () => {
      vi.mocked(uploadToCloudinary).mockResolvedValueOnce({
        url: "https://cloudinary.example.com/crm-pmu/temp/asset.png",
        publicId: "cleanup-target-public-id",
      });

      const { withMediaUpload } = await import("@/features/media/server/service");
      const file = testImageFile();
      await expect(
        withMediaUpload(
          file,
          {
            studioId: studioA,
            clientId: clientA,
            type: "before",
            createdById: userA,
          },
          async () => {
            throw new Error("Simulated DB persistence failure");
          }
        )
      ).rejects.toThrow("Simulated DB persistence failure");

      expect(deleteFromCloudinary).toHaveBeenCalledWith(
        "cleanup-target-public-id",
        {
          resource_type: "image",
          type: "authenticated",
        }
      );
    });
  });
});
