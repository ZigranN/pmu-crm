"use server";
import { writeActivity } from "@/server/services/activity.service";
import { writeAudit } from "@/server/services/audit-log.service";

import { db } from "@/db";
import { clientMedicalProfiles } from "@/db/schema";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function upsertMedicalProfileAction(clientId: string, input: MedicalProfileSchema) {
  const { studioId, userId } = await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const validated = medicalProfileSchema.parse(input);
  await db.transaction(async (tx) => {
    await lockClient(tx, clientId, studioId, userId, false, "MEDICAL_PROFILE_UPDATE");
    const before = await tx.query.clientMedicalProfiles.findFirst({ where: and(eq(clientMedicalProfiles.clientId, clientId), isNull(clientMedicalProfiles.supersededAt)) });
    const [after] = await tx.insert(clientMedicalProfiles).values({ ...validated, clientId })
      .onConflictDoUpdate({ target: clientMedicalProfiles.clientId, targetWhere: isNull(clientMedicalProfiles.supersededAt), set: { ...validated, updatedAt: new Date() } }).returning();
    await writeActivity(tx, { studioId, clientId, userId, type: "medical_profile_updated",
      title: "Мед. профиль обновлен", description: "Медицинская анкета клиента была обновлена" });
    await writeAudit(tx, { studioId, userId, action: "medical_profile_updated", entityType: "client_medical_profile",
      entityId: clientId, before: before ?? null, after, reason: "command:medical_profile_updated", metadata: { updatedFields: Object.keys(validated) } });
  });
  revalidatePath(`/clients/${clientId}`);
}

// Explicit acknowledgement of preserved evidence; this is not a medical clearance command.
export async function acknowledgeMedicalMergeReview(clientId: string, reason: string, expectedUpdatedAt: string) {
  const { z } = await import("zod"); z.string().trim().min(3).max(1000).parse(reason); z.string().datetime().parse(expectedUpdatedAt);
  const context = await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const { hasPermission } = await import("@/lib/permissions");
  await db.transaction(async tx => {
    await lockClient(tx, clientId, context.studioId, context.userId, false, "MEDICAL_PROFILE_UPDATE");
    if (!await hasPermission(tx, context.userId, context.studioId, "MEDICAL_PROFILE_READ")) throw new Error("Permission denied");
    const [before] = await tx.select().from(clientMedicalProfiles).where(and(eq(clientMedicalProfiles.clientId,clientId),isNull(clientMedicalProfiles.supersededAt)));
    if (!before?.mergeReviewRequired) return;
    if (before.updatedAt.toISOString() !== expectedUpdatedAt) throw new Error("Медицинские сведения изменились. Обновите карточку и повторите проверку.");
    const [after] = await tx.update(clientMedicalProfiles).set({ mergeReviewRequired: false, updatedAt: new Date() }).where(eq(clientMedicalProfiles.id,before.id)).returning();
    await writeAudit(tx, { ...context, action: "medical_profile_updated", entityType: "client_medical_profile", entityId: before.id, before, after, reason: reason.trim(), reasonSource: "user", metadata: { operation: "merge_evidence_review" } });
    await writeActivity(tx, { ...context, clientId, type: "medical_profile_updated", title: "Исторические медицинские сведения проверены", description: reason.trim() });
  });
  revalidatePath(`/clients/${clientId}`);
}
