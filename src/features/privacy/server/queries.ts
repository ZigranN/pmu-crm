import "server-only";
import { db } from "@/db";
import {
  privacyRequests,
  clients,
  studioPrivacyRetentionPolicies,
  user,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sensitiveRead, recordIds } from "@/server/services/access-log.service";

export interface PrivacyRequestViewModel {
  id: string;
  studioId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  requestType: "EXPORT" | "ANONYMIZE" | "DELETE_WHERE_ALLOWED";
  status: "REQUESTED" | "APPROVED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  requestedById: string;
  requestedByName?: string | null;
  requestedAt: Date;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  failureReason?: string | null;
  exportArtifactId?: string | null;
  exportExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getPrivacyRequests(studioId: string): Promise<PrivacyRequestViewModel[]> {
  return await sensitiveRead<PrivacyRequestViewModel[]>(
    "PRIVACY_READ",
    studioId,
    { operation: "privacy.requests.list" },
    async () => {
      const rows = await db
        .select({
          id: privacyRequests.id,
          studioId: privacyRequests.studioId,
          clientId: privacyRequests.clientId,
          clientName: clients.fullName,
          clientPhone: clients.phone,
          requestType: privacyRequests.requestType,
          status: privacyRequests.status,
          requestedById: privacyRequests.requestedById,
          requestedByName: user.name,
          requestedAt: privacyRequests.requestedAt,
          approvedById: privacyRequests.approvedById,
          approvedAt: privacyRequests.approvedAt,
          startedAt: privacyRequests.startedAt,
          completedAt: privacyRequests.completedAt,
          failedAt: privacyRequests.failedAt,
          failureReason: privacyRequests.failureReason,
          exportArtifactId: privacyRequests.exportArtifactId,
          exportExpiresAt: privacyRequests.exportExpiresAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
        })
        .from(privacyRequests)
        .leftJoin(clients, and(eq(clients.id, privacyRequests.clientId), eq(clients.studioId, privacyRequests.studioId)))
        .leftJoin(user, eq(user.id, privacyRequests.requestedById))
        .where(eq(privacyRequests.studioId, studioId))
        .orderBy(desc(privacyRequests.createdAt));

      return rows.map((r) => ({
        ...r,
        clientName: r.clientName || "Unknown Client",
        clientPhone: r.clientPhone || "",
      }));
    },
    recordIds
  );
}

export async function getClientPrivacyHistory(
  clientId: string,
  studioId: string
): Promise<PrivacyRequestViewModel[]> {
  return await sensitiveRead<PrivacyRequestViewModel[]>(
    "PRIVACY_READ",
    studioId,
    { operation: "privacy.requests.list", targetId: clientId },
    async () => {
      const rows = await db
        .select({
          id: privacyRequests.id,
          studioId: privacyRequests.studioId,
          clientId: privacyRequests.clientId,
          clientName: clients.fullName,
          clientPhone: clients.phone,
          requestType: privacyRequests.requestType,
          status: privacyRequests.status,
          requestedById: privacyRequests.requestedById,
          requestedByName: user.name,
          requestedAt: privacyRequests.requestedAt,
          approvedById: privacyRequests.approvedById,
          approvedAt: privacyRequests.approvedAt,
          startedAt: privacyRequests.startedAt,
          completedAt: privacyRequests.completedAt,
          failedAt: privacyRequests.failedAt,
          failureReason: privacyRequests.failureReason,
          exportArtifactId: privacyRequests.exportArtifactId,
          exportExpiresAt: privacyRequests.exportExpiresAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
        })
        .from(privacyRequests)
        .leftJoin(clients, and(eq(clients.id, privacyRequests.clientId), eq(clients.studioId, privacyRequests.studioId)))
        .leftJoin(user, eq(user.id, privacyRequests.requestedById))
        .where(and(eq(privacyRequests.studioId, studioId), eq(privacyRequests.clientId, clientId)))
        .orderBy(desc(privacyRequests.createdAt));

      return rows.map((r) => ({
        ...r,
        clientName: r.clientName || "Unknown Client",
        clientPhone: r.clientPhone || "",
      }));
    },
    recordIds
  );
}

export async function getStudioRetentionPolicy(studioId: string) {
  const [policy] = await db
    .select()
    .from(studioPrivacyRetentionPolicies)
    .where(eq(studioPrivacyRetentionPolicies.studioId, studioId))
    .limit(1);

  return {
    temporaryUploadRetentionDays: policy?.temporaryUploadRetentionDays ?? 7,
    privacyExportRetentionDays: policy?.privacyExportRetentionDays ?? 30,
    orphanMediaGraceDays: policy?.orphanMediaGraceDays ?? 14,
  };
}
