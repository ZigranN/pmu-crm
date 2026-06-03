"use server";

import { db } from "@/db";
import { consents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { mediaService } from "@/features/media/server/service";
import { auditLogService } from "@/server/services/audit-log.service";
import { activityService } from "@/server/services/activity.service";

export interface CreateConsentInput {
  studioId: string;
  clientId: string;
  procedureSessionId?: string;
  consentType: "pmu_general" | "brows" | "lips" | "eyes" | "facial" | "remover" | "photo_permission" | "marketing_permission" | "other";
  signedAt: Date;
  notes?: string;
  createdById: string;
}

export const consentService = {
  async uploadConsent(file: File, input: CreateConsentInput) {
    // Upload media first
    const newMedia = await mediaService.uploadMedia(file, {
      studioId: input.studioId,
      clientId: input.clientId,
      procedureSessionId: input.procedureSessionId,
      type: "consent",
      caption: input.consentType,
      createdById: input.createdById,
    });

    // Create consent record
    const [consent] = await db.insert(consents).values({
      studioId: input.studioId,
      clientId: input.clientId,
      procedureSessionId: input.procedureSessionId || null,
      mediaId: newMedia.id,
      consentType: input.consentType as any,
      signedAt: input.signedAt,
      expiresAt: null,
      notes: input.notes || null,
    }).returning();

    // Create audit log
    await auditLogService.create({
      studioId: input.studioId,
      userId: input.createdById,
      action: "consent_uploaded",
      entityType: "consent",
      entityId: consent.id,
      metadata: {
        clientId: input.clientId,
        consentType: input.consentType,
      },
    });

    // Create activity event
    await activityService.create({
      studioId: input.studioId,
      clientId: input.clientId,
      userId: input.createdById,
      type: "consent_uploaded",
      title: "Согласие загружено",
      description: `Добавлено согласие: ${input.consentType}`,
    });

    return consent;
  },

  async getClientConsents(clientId: string, studioId: string) {
    // Note: Simplified to avoid Drizzle relations issues
    // Media can be fetched separately if needed
    return await db.query.consents.findMany({
      where: and(
        eq(consents.clientId, clientId),
        eq(consents.studioId, studioId)
      ),
      orderBy: (consents, { desc }) => [desc(consents.signedAt)],
    });
  },

  async deleteConsent(consentId: string, studioId: string, userId: string) {
    const consent = await db.query.consents.findFirst({
      where: and(eq(consents.id, consentId), eq(consents.studioId, studioId)),
    });

    if (!consent) {
      throw new Error("Consent not found");
    }

    // Delete media
    await mediaService.deleteMedia(consent.mediaId, studioId, userId);

    // Delete consent record (cascade will handle it when media is deleted)
    await db.delete(consents).where(eq(consents.id, consentId));

    // Create audit log
    await auditLogService.create({
      studioId,
      userId,
      action: "consent_deleted",
      entityType: "consent",
      entityId: consentId,
      metadata: {
        clientId: consent.clientId,
        consentType: consent.consentType,
      },
    });

    // Create activity event
    await activityService.create({
      studioId,
      clientId: consent.clientId,
      userId,
      type: "consent_deleted",
      title: "Согласие удалено",
      description: `Удалено согласие: ${consent.consentType}`,
    });
  },
};
