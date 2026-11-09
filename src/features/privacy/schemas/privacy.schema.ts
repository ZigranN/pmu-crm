import { z } from "zod";

export const PrivacyRequestTypeEnum = z.enum(["EXPORT", "ANONYMIZE", "DELETE_WHERE_ALLOWED"]);
export type PrivacyRequestType = z.infer<typeof PrivacyRequestTypeEnum>;

export const PrivacyRequestStatusEnum = z.enum([
  "REQUESTED",
  "APPROVED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type PrivacyRequestStatus = z.infer<typeof PrivacyRequestStatusEnum>;

export const CreatePrivacyRequestSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  requestType: PrivacyRequestTypeEnum,
  reason: z.string().min(3, "Reason must be at least 3 characters").max(1000).optional(),
});
export type CreatePrivacyRequestInput = z.infer<typeof CreatePrivacyRequestSchema>;

export const ApprovePrivacyRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request ID"),
});
export type ApprovePrivacyRequestInput = z.infer<typeof ApprovePrivacyRequestSchema>;

export const CancelPrivacyRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request ID"),
  reason: z.string().min(3, "Reason must be at least 3 characters").max(1000).optional(),
});
export type CancelPrivacyRequestInput = z.infer<typeof CancelPrivacyRequestSchema>;

export const AnonymizeClientSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  confirmClientName: z.string().min(1, "Client confirmation name is required"),
  reason: z.string().min(3, "Reason must be at least 3 characters").max(1000),
});
export type AnonymizeClientInput = z.infer<typeof AnonymizeClientSchema>;

export const UpdateRetentionPolicySchema = z.object({
  temporaryUploadRetentionDays: z.number().int().min(1).max(365),
  privacyExportRetentionDays: z.number().int().min(1).max(365),
  orphanMediaGraceDays: z.number().int().min(1).max(365),
});
export type UpdateRetentionPolicyInput = z.infer<typeof UpdateRetentionPolicySchema>;

export interface ClientExportManifest {
  generatedAt: string;
  studioId: string;
  clientId: string;
  schemaVersion: string;
  recordCounts: Record<string, number>;
  mediaManifest: Array<{
    mediaId: string;
    type: string;
    url: string;
    caption?: string | null;
    sha256?: string;
    createdAt: string;
  }>;
}

export interface ClientExportBundle {
  manifest: ClientExportManifest;
  client: Record<string, unknown>;
  treatmentCycles: unknown[];
  treatmentPackages: unknown[];
  appointments: unknown[];
  medicalProfiles: unknown[];
  medicalProfileRevisions: unknown[];
  medicalClearances: unknown[];
  consents: unknown[];
  cycleConsents: unknown[];
  procedures: unknown[];
  payments: unknown[];
  ledgerEntries: unknown[];
  offers: unknown[];
  conversations: unknown[];
  messages: unknown[];
  handoffs: unknown[];
  automationExecutions: unknown[];
  reviews: unknown[];
  questionnaires: unknown[];
}
