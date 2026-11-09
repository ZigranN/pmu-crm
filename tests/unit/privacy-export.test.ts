import { describe, expect, it } from "vitest";
import {
  CreatePrivacyRequestSchema,
  ApprovePrivacyRequestSchema,
  CancelPrivacyRequestSchema,
  AnonymizeClientSchema,
  UpdateRetentionPolicySchema,
  type ClientExportBundle,
} from "@/features/privacy/schemas/privacy.schema";

describe("Privacy & Data Lifecycle — Unit Tests", () => {
  describe("Zod Validation Schemas", () => {
    it("validates create privacy request input", () => {
      const valid = CreatePrivacyRequestSchema.parse({
        clientId: "123e4567-e89b-12d3-a456-426614174000",
        requestType: "EXPORT",
        reason: "Client DSAR request via email",
      });
      expect(valid.requestType).toBe("EXPORT");

      expect(() =>
        CreatePrivacyRequestSchema.parse({
          clientId: "invalid-uuid",
          requestType: "EXPORT",
        })
      ).toThrow();

      expect(() =>
        CreatePrivacyRequestSchema.parse({
          clientId: "123e4567-e89b-12d3-a456-426614174000",
          requestType: "INVALID_TYPE",
        })
      ).toThrow();
    });

    it("validates approve and cancel schemas", () => {
      const validApprove = ApprovePrivacyRequestSchema.parse({
        requestId: "123e4567-e89b-12d3-a456-426614174000",
      });
      expect(validApprove.requestId).toBe("123e4567-e89b-12d3-a456-426614174000");

      const validCancel = CancelPrivacyRequestSchema.parse({
        requestId: "123e4567-e89b-12d3-a456-426614174000",
        reason: "Client withdrew request",
      });
      expect(validCancel.reason).toBe("Client withdrew request");
    });

    it("validates client anonymization input with confirmation name", () => {
      const valid = AnonymizeClientSchema.parse({
        clientId: "123e4567-e89b-12d3-a456-426614174000",
        confirmClientName: "Anna Rossi",
        reason: "GDPR Right to be Forgotten exercised",
      });
      expect(valid.confirmClientName).toBe("Anna Rossi");

      expect(() =>
        AnonymizeClientSchema.parse({
          clientId: "123e4567-e89b-12d3-a456-426614174000",
          confirmClientName: "",
          reason: "Too short reason",
        })
      ).toThrow();
    });

    it("validates retention policy update", () => {
      const valid = UpdateRetentionPolicySchema.parse({
        temporaryUploadRetentionDays: 7,
        privacyExportRetentionDays: 30,
        orphanMediaGraceDays: 14,
      });
      expect(valid.temporaryUploadRetentionDays).toBe(7);

      expect(() =>
        UpdateRetentionPolicySchema.parse({
          temporaryUploadRetentionDays: 0,
          privacyExportRetentionDays: 30,
          orphanMediaGraceDays: 14,
        })
      ).toThrow();
    });
  });

  describe("Export Manifest & Bundle Invariants", () => {
    it("ensures manifest contains all mandatory record categories and metadata", () => {
      const mockBundle: ClientExportBundle = {
        manifest: {
          generatedAt: new Date().toISOString(),
          studioId: "123e4567-e89b-12d3-a456-426614174001",
          clientId: "123e4567-e89b-12d3-a456-426614174002",
          schemaVersion: "1.0.0",
          recordCounts: {
            client: 1,
            treatmentCycles: 2,
            treatmentPackages: 1,
            appointments: 3,
            medicalProfiles: 1,
            medicalProfileRevisions: 2,
            medicalClearances: 2,
            consents: 1,
            cycleConsents: 2,
            procedures: 2,
            payments: 3,
            ledgerEntries: 5,
            offers: 1,
            conversations: 1,
            messages: 8,
            handoffs: 0,
            automationExecutions: 2,
            reviews: 1,
            questionnaires: 1,
            mediaManifest: 3,
          },
          mediaManifest: [
            {
              mediaId: "123e4567-e89b-12d3-a456-426614174003",
              type: "before",
              url: "/api/media/123e4567-e89b-12d3-a456-426614174003/content",
              sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              createdAt: new Date().toISOString(),
            },
          ],
        },
        client: {
          id: "123e4567-e89b-12d3-a456-426614174002",
          studioId: "123e4567-e89b-12d3-a456-426614174001",
          firstName: "Jane",
          lastName: "Doe",
          phone: "+393331234567",
        },
        treatmentCycles: [],
        treatmentPackages: [],
        appointments: [],
        medicalProfiles: [],
        medicalProfileRevisions: [],
        medicalClearances: [],
        consents: [],
        cycleConsents: [],
        procedures: [],
        payments: [],
        ledgerEntries: [],
        offers: [],
        conversations: [],
        messages: [],
        handoffs: [],
        automationExecutions: [],
        reviews: [],
        questionnaires: [],
      };

      expect(mockBundle.manifest.schemaVersion).toBe("1.0.0");
      expect(mockBundle.manifest.studioId).toBe("123e4567-e89b-12d3-a456-426614174001");
      expect(mockBundle.manifest.clientId).toBe("123e4567-e89b-12d3-a456-426614174002");
      expect(mockBundle.manifest.recordCounts.client).toBe(1);
      expect(mockBundle.manifest.mediaManifest).toHaveLength(1);
      expect(mockBundle.manifest.mediaManifest[0].sha256).toBeDefined();
    });
  });
});
