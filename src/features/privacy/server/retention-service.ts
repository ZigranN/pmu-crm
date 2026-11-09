import "server-only";
import { db } from "@/db";
import {
  media,
  consents,
  privacyRequests,
  studioPrivacyRetentionPolicies,
} from "@/db/schema";
import { eq, and, isNotNull, lt } from "drizzle-orm";
import type { Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";

export type MediaClassification =
  | "AUTHORITATIVE_EVIDENCE"
  | "CLIENT_GENERAL_MEDIA"
  | "EXPIRED_EXPORT"
  | "ORPHAN"
  | "ACTIVE_EXPORT";

export interface RetentionCleanupResult {
  expiredExportsCount: number;
  orphanMediaCount: number;
  preservedEvidenceCount: number;
}

/**
 * Classifies a media row based on legal evidence rules, client references, and lifecycle states.
 */
export async function classifyMedia(
  mediaRecord: typeof media.$inferSelect,
  tx: Transaction
): Promise<MediaClassification> {
  // 1. Authoritative consent evidence: Never eligible for generic cleanup
  if (mediaRecord.type === "consent") {
    return "AUTHORITATIVE_EVIDENCE";
  }

  const [referencedInConsents] = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(and(eq(consents.mediaId, mediaRecord.id), eq(consents.studioId, mediaRecord.studioId)))
    .limit(1);

  if (referencedInConsents) {
    return "AUTHORITATIVE_EVIDENCE";
  }

  // 2. Clinical procedure photos (before, after, healing, correction, refresh) linked to session
  if (
    mediaRecord.procedureSessionId ||
    mediaRecord.appointmentId
  ) {
    if (
      ["before", "after", "healing_day_7", "healing_day_30", "correction", "refresh"].includes(
        mediaRecord.type
      ) &&
      !mediaRecord.deletedAt
    ) {
      return "AUTHORITATIVE_EVIDENCE";
    }
  }

  // 3. Privacy exports
  if (mediaRecord.type === "document" && mediaRecord.publicId?.startsWith("export-")) {
    const [privacyReq] = await tx
      .select({
        id: privacyRequests.id,
        exportExpiresAt: privacyRequests.exportExpiresAt,
      })
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.exportArtifactId, mediaRecord.id),
          eq(privacyRequests.studioId, mediaRecord.studioId)
        )
      )
      .limit(1);

    if (privacyReq) {
      if (privacyReq.exportExpiresAt && new Date() > privacyReq.exportExpiresAt) {
        return "EXPIRED_EXPORT";
      }
      return "ACTIVE_EXPORT";
    }
  }

  // 4. Soft-deleted media
  if (mediaRecord.deletedAt !== null) {
    return "ORPHAN";
  }

  return "CLIENT_GENERAL_MEDIA";
}

/**
 * Cleans up expired privacy export media artifacts and unlinks them from completed requests.
 */
export async function cleanupExpiredPrivacyExports(
  studioId: string,
  tx: Transaction
): Promise<{ deletedExportMediaCount: number }> {
  const expiredRequests = await tx
    .select()
    .from(privacyRequests)
    .where(
      and(
        eq(privacyRequests.studioId, studioId),
        eq(privacyRequests.status, "COMPLETED"),
        isNotNull(privacyRequests.exportArtifactId),
        isNotNull(privacyRequests.exportExpiresAt),
        lt(privacyRequests.exportExpiresAt, new Date())
      )
    );

  let deletedCount = 0;
  for (const req of expiredRequests) {
    if (req.exportArtifactId) {
      // Delete or unlink artifact media row
      await tx
        .delete(media)
        .where(and(eq(media.id, req.exportArtifactId), eq(media.studioId, studioId)));

      await tx
        .update(privacyRequests)
        .set({
          exportArtifactId: null,
          updatedAt: new Date(),
        })
        .where(eq(privacyRequests.id, req.id));

      deletedCount++;
    }
  }

  return { deletedExportMediaCount: deletedCount };
}

/**
 * Deterministically detects and safely cleans up orphaned media files.
 * Enforces a configurable grace period and strictly guards active evidence,
 * signed consent PDFs, and in-flight uploads.
 */
export async function cleanupOrphanMedia(
  studioId: string,
  tx: Transaction,
  overrideGraceDays?: number
): Promise<{ deletedOrphanMediaCount: number; preservedEvidenceCount: number }> {
  const [policy] = await tx
    .select()
    .from(studioPrivacyRetentionPolicies)
    .where(eq(studioPrivacyRetentionPolicies.studioId, studioId))
    .limit(1);

  const graceDays = overrideGraceDays ?? policy?.orphanMediaGraceDays ?? 14;
  const cutoffDate = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

  // Candidate media: created before grace period and soft-deleted (deletedAt is not null)
  const candidateMedia = await tx
    .select()
    .from(media)
    .where(
      and(
        eq(media.studioId, studioId),
        isNotNull(media.deletedAt),
        lt(media.createdAt, cutoffDate)
      )
    );

  let deletedCount = 0;
  let preservedCount = 0;

  for (const item of candidateMedia) {
    const classification = await classifyMedia(item, tx);

    if (
      classification === "AUTHORITATIVE_EVIDENCE" ||
      classification === "ACTIVE_EXPORT"
    ) {
      // Guarded: Never delete authoritative evidence even if soft-deleted flag is set
      preservedCount++;
      continue;
    }

    if (classification === "ORPHAN" || classification === "EXPIRED_EXPORT") {
      await tx
        .delete(media)
        .where(and(eq(media.id, item.id), eq(media.studioId, studioId)));
      deletedCount++;
    }
  }

  return {
    deletedOrphanMediaCount: deletedCount,
    preservedEvidenceCount: preservedCount,
  };
}

/**
 * Executes a unified retention cleanup run for a studio, enforcing export expiration
 * and orphan media garbage collection inside a transaction with audit logging.
 */
export async function executeRetentionCleanup(
  studioId: string,
  actorId = "system"
): Promise<RetentionCleanupResult> {
  return await db.transaction(async (tx) => {
    const exportsResult = await cleanupExpiredPrivacyExports(studioId, tx);
    const orphanResult = await cleanupOrphanMedia(studioId, tx);

    await writeAudit(tx, {
      studioId,
      userId: actorId,
      action: "retention_cleanup_executed",
      entityType: "studio",
      entityId: studioId,
      before: null,
      after: {
        expiredExportsCleaned: exportsResult.deletedExportMediaCount,
        orphanMediaCleaned: orphanResult.deletedOrphanMediaCount,
        evidencePreserved: orphanResult.preservedEvidenceCount,
      },
      reason: "command:retention_cleanup_executed",
      metadata: { actorId },
    });

    return {
      expiredExportsCount: exportsResult.deletedExportMediaCount,
      orphanMediaCount: orphanResult.deletedOrphanMediaCount,
      preservedEvidenceCount: orphanResult.preservedEvidenceCount,
    };
  });
}
