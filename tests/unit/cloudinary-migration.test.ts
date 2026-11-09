import { describe, expect, it, vi } from "vitest";
import {
  parseCliArgs,
  validateExecutionGuard,
  deriveResourceType,
  isSensitiveMediaType,
  probeProviderAsset,
  runMigration,
  type CloudinaryApi,
  type CloudinaryUploader,
  type MigrationDatabase,
  type CandidateMediaRecord,
} from "@/../scripts/migrate-cloudinary-authenticated";

describe("Phase 1.3C2B Cloudinary Authenticated Migration Utility Tests", () => {
  describe("1. CLI Arguments & Execution Guard", () => {
    it("defaults to dry-run mode when no arguments are passed", () => {
      const parsed = parseCliArgs([]);
      expect(parsed.mode).toBe("dry-run");
      expect(() => validateExecutionGuard(parsed)).not.toThrow();
    });

    it("parses explicit --dry-run flag", () => {
      const parsed = parseCliArgs(["--dry-run"]);
      expect(parsed.mode).toBe("dry-run");
      expect(() => validateExecutionGuard(parsed)).not.toThrow();
    });

    it("aborts when --execute is passed without --confirm=authenticated-migration", () => {
      const parsed = parseCliArgs(["--execute"]);
      expect(parsed.mode).toBe("execute");
      expect(() => validateExecutionGuard(parsed)).toThrow(
        "Execution guard failed: --execute requires explicit confirmation flag --confirm=authenticated-migration"
      );
    });

    it("aborts when --execute is passed with wrong confirmation token", () => {
      const parsed = parseCliArgs(["--execute", "--confirm=yes"]);
      expect(parsed.mode).toBe("execute");
      expect(() => validateExecutionGuard(parsed)).toThrow(
        "Execution guard failed: --execute requires explicit confirmation flag --confirm=authenticated-migration"
      );
    });

    it("passes execution guard when --execute and exact --confirm=authenticated-migration are provided", () => {
      const parsed = parseCliArgs(["--execute", "--confirm=authenticated-migration"]);
      expect(parsed.mode).toBe("execute");
      expect(() => validateExecutionGuard(parsed)).not.toThrow();
    });
  });

  describe("2. Sensitive Predicate & Resource Type Derivation", () => {
    it("classifies sensitive media types correctly", () => {
      const sensitiveList = [
        "before",
        "after",
        "healing_day_7",
        "healing_day_30",
        "correction",
        "refresh",
        "consent",
        "portfolio",
        "document",
        "other",
      ];
      for (const type of sensitiveList) {
        expect(isSensitiveMediaType(type)).toBe(true);
      }
      expect(isSensitiveMediaType("unknown_type")).toBe(false);
      expect(isSensitiveMediaType("master_photo")).toBe(false);
      expect(isSensitiveMediaType("studio_logo")).toBe(false);
    });

    it("derives resource type deterministically", () => {
      expect(
        deriveResourceType("https://res.cloudinary.com/cloud/image/upload/v1/crm-pmu/st/before/1.jpg")
      ).toBe("image");
      expect(
        deriveResourceType("https://res.cloudinary.com/cloud/raw/upload/v1/crm-pmu/st/consent/1.pdf")
      ).toBe("raw");
      expect(
        deriveResourceType("https://res.cloudinary.com/cloud/image/authenticated/s--sig--/v1/crm-pmu/st/before/1.jpg")
      ).toBe("image");
      expect(
        deriveResourceType("https://res.cloudinary.com/cloud/raw/authenticated/s--sig--/v1/crm-pmu/st/consent/1.pdf")
      ).toBe("raw");
      expect(deriveResourceType("https://example.com/some/path/document.pdf")).toBe("raw");
      expect(deriveResourceType("https://example.com/some/path/photo.png")).toBe("image");
    });

    it("fails closed on unclassifiable URLs", () => {
      expect(deriveResourceType("")).toBeNull();
      expect(deriveResourceType("   ")).toBeNull();
      expect(deriveResourceType(null)).toBeNull();
      expect(deriveResourceType(undefined)).toBeNull();
      expect(deriveResourceType("https://example.com/unsupported/media.mp4")).toBeNull();
      expect(deriveResourceType("https://example.com/path-without-extension")).toBeNull();
    });
  });

  describe("3. Provider State Probing", () => {
    it("identifies UPLOAD_EXISTS when upload bucket returns 200 and authenticated returns 404", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          if (options.type === "upload") return { public_id: publicId, type: "upload" };
          const err: any = new Error("Not found");
          err.http_code = 404;
          throw err;
        }),
      };

      const result = await probeProviderAsset("asset-1", "image", api);
      expect(result.state).toBe("UPLOAD_EXISTS");
      expect(result.uploadDetails).toBeDefined();
    });

    it("identifies AUTHENTICATED_EXISTS when upload returns 404 and authenticated returns 200", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          if (options.type === "authenticated") return { public_id: publicId, type: "authenticated" };
          const err: any = new Error("Not found");
          err.http_code = 404;
          throw err;
        }),
      };

      const result = await probeProviderAsset("asset-2", "image", api);
      expect(result.state).toBe("AUTHENTICATED_EXISTS");
      expect(result.authenticatedDetails).toBeDefined();
    });

    it("identifies BOTH_EXIST when both buckets return 200", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          return { public_id: publicId, type: options.type };
        }),
      };

      const result = await probeProviderAsset("asset-3", "image", api);
      expect(result.state).toBe("BOTH_EXIST");
    });

    it("identifies NEITHER_EXISTS when both buckets return 404", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async () => {
          const err: any = new Error("Not found");
          err.http_code = 404;
          throw err;
        }),
      };

      const result = await probeProviderAsset("asset-4", "raw", api);
      expect(result.state).toBe("NEITHER_EXISTS");
    });

    it("classifies HTTP 429 rate limit as LOOKUP_FAILED (not missing)", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async () => {
          const err: any = new Error("Rate limit exceeded");
          err.http_code = 429;
          throw err;
        }),
      };

      const result = await probeProviderAsset("asset-5", "image", api);
      expect(result.state).toBe("LOOKUP_FAILED");
      expect(result.error).toContain("Rate limit exceeded");
    });

    it("classifies HTTP 500 server error as LOOKUP_FAILED", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async () => {
          const err: any = new Error("Internal provider error");
          err.http_code = 500;
          throw err;
        }),
      };

      const result = await probeProviderAsset("asset-6", "image", api);
      expect(result.state).toBe("LOOKUP_FAILED");
    });

    it("classifies network/timeout error as LOOKUP_FAILED", async () => {
      const api: CloudinaryApi = {
        resource: vi.fn(async () => {
          throw new Error("ECONNRESET network failure");
        }),
      };

      const result = await probeProviderAsset("asset-7", "image", api);
      expect(result.state).toBe("LOOKUP_FAILED");
      expect(result.error).toContain("ECONNRESET");
    });
  });

  describe("4. Dry-Run Mode Safety Guarantees", () => {
    it("executes dry-run and NEVER calls uploader.rename or uploader.destroy (0 provider mutations)", async () => {
      const mockRows: CandidateMediaRecord[] = [
        {
          id: "m-1",
          studioId: "st-1",
          type: "before",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/before/asset-1.jpg",
          publicId: "st-1/before/asset-1",
          deletedAt: null,
        },
        {
          id: "m-2",
          studioId: "st-1",
          type: "consent",
          url: "https://res.cloudinary.com/cloud/raw/upload/v1/st-1/consent/doc-2.pdf",
          publicId: "st-1/consent/doc-2",
          deletedAt: new Date(),
        },
        {
          id: "m-3",
          studioId: "st-1",
          type: "after",
          url: "https://res.cloudinary.com/cloud/image/authenticated/s--sig--/v1/st-1/after/asset-3.jpg",
          publicId: "st-1/after/asset-3",
          deletedAt: null,
        },
        {
          id: "m-4",
          studioId: "st-1",
          type: "healing_day_7",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/healing/asset-4.jpg",
          publicId: "st-1/healing/asset-4",
          deletedAt: null,
        },
        {
          id: "m-5",
          studioId: "st-1",
          type: "correction",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/correction/asset-5.jpg",
          publicId: "st-1/correction/asset-5",
          deletedAt: null,
        },
        {
          id: "m-6",
          studioId: "st-1",
          type: "other",
          url: "https://example.com/unknown/format.xyz",
          publicId: "st-1/other/asset-6",
          deletedAt: null,
        },
        {
          id: "m-7",
          studioId: "st-1",
          type: "non_sensitive_custom",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/custom/img.jpg",
          publicId: "st-1/custom/img",
          deletedAt: null,
        },
      ];

      const dbMock: MigrationDatabase = {
        fetchCandidateMediaRows: vi.fn(async () => mockRows),
      };

      const apiMock: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          if (publicId === "st-1/before/asset-1" || publicId === "st-1/consent/doc-2") {
            if (options.type === "upload") return { public_id: publicId, type: "upload" };
            const err: any = new Error("Not found");
            err.http_code = 404;
            throw err;
          }
          if (publicId === "st-1/after/asset-3") {
            if (options.type === "authenticated") return { public_id: publicId, type: "authenticated" };
            const err: any = new Error("Not found");
            err.http_code = 404;
            throw err;
          }
          if (publicId === "st-1/healing/asset-4") {
            return { public_id: publicId, type: options.type };
          }
          if (publicId === "st-1/correction/asset-5") {
            const err: any = new Error("Not found");
            err.http_code = 404;
            throw err;
          }
          return { public_id: publicId, type: options.type };
        }),
      };

      const renameSpy = vi.fn();
      const destroySpy = vi.fn();
      const uploaderMock: CloudinaryUploader = {
        rename: renameSpy,
        destroy: destroySpy,
      };

      const report = await runMigration(
        { mode: "dry-run", silent: true },
        { db: dbMock, cloudinary: { api: apiMock, uploader: uploaderMock } }
      );

      // Hard safety assertions
      expect(renameSpy).toHaveBeenCalledTimes(0);
      expect(destroySpy).toHaveBeenCalledTimes(0);

      // Report assertions
      expect(report.mode).toBe("dry-run");
      expect(report.candidate).toBe(6); // 7 rows minus 1 non-sensitive
      expect(report.active_candidates).toBe(5);
      expect(report.archived_candidates).toBe(1);
      expect(report.would_migrate).toBe(2); // asset-1 and doc-2
      expect(report.migrated).toBe(0);
      expect(report.already_authenticated).toBe(1); // asset-3
      expect(report.provider_conflict).toBe(1); // asset-4 (both exist)
      expect(report.missing_provider_asset).toBe(1); // asset-5 (neither exists)
      expect(report.unclassifiable_resource_type).toBe(1); // asset-6 (unknown format)
      expect(report.skipped_non_sensitive).toBe(1); // m-7
      expect(report.migration_failed).toBe(0);
      expect(report.verification_failed).toBe(0);

      // Deterministic per-row evidence
      expect(report.rows.length).toBe(7);
      expect(report.rows[0].plannedAction).toBe("WOULD_MIGRATE");
      expect(report.rows[0].providerState).toBe("UPLOAD_EXISTS");
      expect(report.rows[1].plannedAction).toBe("WOULD_MIGRATE");
      expect(report.rows[1].archived).toBe(true);
      expect(report.rows[2].plannedAction).toBe("ALREADY_AUTHENTICATED");
      expect(report.rows[3].plannedAction).toBe("PROVIDER_CONFLICT");
      expect(report.rows[4].plannedAction).toBe("MISSING_PROVIDER_ASSET");
      expect(report.rows[5].plannedAction).toBe("UNCLASSIFIABLE_RESOURCE_TYPE");
      expect(report.rows[6].plannedAction).toBe("SKIPPED_NON_SENSITIVE");
    });
  });

  describe("5. Future Live Execution Branch Safety (Simulated Mock Tests)", () => {
    it("executes rename with overwrite=false and performs two-point post-verification", async () => {
      const mockRows: CandidateMediaRecord[] = [
        {
          id: "m-live-1",
          studioId: "st-1",
          type: "before",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/before/img1.jpg",
          publicId: "st-1/before/img1",
          deletedAt: null,
        },
      ];

      const dbMock: MigrationDatabase = {
        fetchCandidateMediaRows: vi.fn(async () => mockRows),
      };

      let postRenamed = false;
      const apiMock: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          if (!postRenamed) {
            if (options.type === "upload") return { public_id: publicId, type: "upload" };
            const err: any = new Error("Not found");
            err.http_code = 404;
            throw err;
          } else {
            if (options.type === "authenticated") return { public_id: publicId, type: "authenticated" };
            const err: any = new Error("Not found");
            err.http_code = 404;
            throw err;
          }
        }),
      };

      const uploaderMock: CloudinaryUploader = {
        rename: vi.fn(async (from, to, opts) => {
          postRenamed = true;
          return {
            public_id: to,
            type: opts.to_type,
            resource_type: opts.resource_type,
          };
        }),
        destroy: vi.fn(),
      };

      const report = await runMigration(
        { mode: "execute", confirm: "authenticated-migration", silent: true },
        { db: dbMock, cloudinary: { api: apiMock, uploader: uploaderMock } }
      );

      expect(uploaderMock.rename).toHaveBeenCalledWith(
        "st-1/before/img1",
        "st-1/before/img1",
        expect.objectContaining({
          resource_type: "image",
          type: "upload",
          to_type: "authenticated",
          invalidate: true,
          overwrite: false, // Critical non-destructive safety setting
        })
      );

      expect(report.migrated).toBe(1);
      expect(report.would_migrate).toBe(0);
      expect(report.verification_failed).toBe(0);
      expect(report.rows[0].plannedAction).toBe("MIGRATED");
    });

    it("flags VERIFICATION_FAILED if post-rename probe fails to confirm AUTHENTICATED_EXISTS", async () => {
      const mockRows: CandidateMediaRecord[] = [
        {
          id: "m-live-2",
          studioId: "st-1",
          type: "before",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/before/img2.jpg",
          publicId: "st-1/before/img2",
          deletedAt: null,
        },
      ];

      const dbMock: MigrationDatabase = {
        fetchCandidateMediaRows: vi.fn(async () => mockRows),
      };

      const apiMock: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          // Pre-probe: upload exists
          // Post-probe: still upload exists (simulate failure of rename propagation)
          if (options.type === "upload") return { public_id: publicId, type: "upload" };
          const err: any = new Error("Not found");
          err.http_code = 404;
          throw err;
        }),
      };

      const uploaderMock: CloudinaryUploader = {
        rename: vi.fn(async (from, to) => ({
          public_id: to,
        })),
        destroy: vi.fn(),
      };

      const report = await runMigration(
        { mode: "execute", confirm: "authenticated-migration", silent: true },
        { db: dbMock, cloudinary: { api: apiMock, uploader: uploaderMock } }
      );

      expect(report.migrated).toBe(0);
      expect(report.verification_failed).toBe(1);
      expect(report.rows[0].plannedAction).toBe("VERIFICATION_FAILED");
    });

    it("flags MIGRATION_FAILED if rename API throws error", async () => {
      const mockRows: CandidateMediaRecord[] = [
        {
          id: "m-live-3",
          studioId: "st-1",
          type: "before",
          url: "https://res.cloudinary.com/cloud/image/upload/v1/st-1/before/img3.jpg",
          publicId: "st-1/before/img3",
          deletedAt: null,
        },
      ];

      const dbMock: MigrationDatabase = {
        fetchCandidateMediaRows: vi.fn(async () => mockRows),
      };

      const apiMock: CloudinaryApi = {
        resource: vi.fn(async (publicId, options) => {
          if (options.type === "upload") return { public_id: publicId, type: "upload" };
          const err: any = new Error("Not found");
          err.http_code = 404;
          throw err;
        }),
      };

      const uploaderMock: CloudinaryUploader = {
        rename: vi.fn(async () => {
          throw new Error("Cloudinary API rename rejected");
        }),
        destroy: vi.fn(),
      };

      const report = await runMigration(
        { mode: "execute", confirm: "authenticated-migration", silent: true },
        { db: dbMock, cloudinary: { api: apiMock, uploader: uploaderMock } }
      );

      expect(report.migrated).toBe(0);
      expect(report.migration_failed).toBe(1);
      expect(report.rows[0].plannedAction).toBe("MIGRATION_FAILED");
    });
  });
});
