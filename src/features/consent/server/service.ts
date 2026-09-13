import { writeActivity } from "@/server/services/activity.service";
import { sensitiveRead, recordIds, } from "@/server/services/access-log.service";
import { writeAudit } from "@/server/services/audit-log.service";
import "server-only";
import { resourceScope } from "@/server/auth/scopes";
import { db } from "@/db";
import { consents, media, consentTypeEnum } from "@/db/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { mediaService, withMediaUpload } from "@/features/media/server/service";
import { z } from "zod";

export interface CreateConsentInput {
  studioId: string; clientId: string; procedureSessionId?: string;
  consentType: typeof consentTypeEnum.enumValues[number];
  signedAt: Date; notes?: string; createdById: string;
}

export const consentService = {
  async uploadConsent(file: File, input: CreateConsentInput) {
    const consentType = z.enum(consentTypeEnum.enumValues).parse(input.consentType);
    const signedAt = z.date().parse(input.signedAt);
    return withMediaUpload(file, { studioId: input.studioId, clientId: input.clientId,
      procedureSessionId: input.procedureSessionId, type: "consent", caption: consentType, createdById: input.createdById },
    async (tx, record) => {
      const [consent] = await tx.insert(consents).values({ studioId: input.studioId, clientId: input.clientId,
        procedureSessionId: input.procedureSessionId || null, mediaId: record.id, consentType, signedAt, notes: input.notes || null }).returning();
      await writeAudit(tx, { studioId: input.studioId, userId: input.createdById, action: "consent_uploaded",
        entityType: "consent", entityId: consent.id, before: null, after: consent, reason: "command:consent_uploaded" });
      await writeActivity(tx, { studioId: input.studioId, clientId: input.clientId, userId: input.createdById,
        type: "consent_uploaded", title: "Согласие загружено", description: `Добавлено согласие: ${consentType}` });
      return consent;
    });
  },

  async getClientConsents(clientId: string, studioId: string) {
    return sensitiveRead("CONSENT_READ", studioId, { operation: "consents.list", targetId: clientId }, async (context) => {
      const scope = await resourceScope(context);
      const rows = await db.select({ consent: consents }).from(consents).innerJoin(media, and(
        eq(media.id, consents.mediaId), eq(media.studioId, studioId), eq(media.clientId, clientId), isNull(media.deletedAt),
      )).where(and(scope.clientReference(sql`${consents.clientId}`), eq(consents.clientId, clientId), eq(consents.studioId, studioId))).orderBy(desc(consents.signedAt));
      return rows.map((row) => row.consent);
    }, recordIds);
  },

  async deleteConsent(consentId: string, studioId: string, userId: string, expectedClientId: string) {
    const consent = await db.query.consents.findFirst({
      where: and(eq(consents.id, consentId), eq(consents.studioId, studioId), eq(consents.clientId, expectedClientId)),
    });
    if (!consent) throw new Error("Consent not found");
    await mediaService.deleteMedia(consent.mediaId, studioId, userId, consent.clientId);
  },
};
