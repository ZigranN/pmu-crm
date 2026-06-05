"use server";

import { db } from "@/db";
import { clientMedicalProfiles } from "@/db/schema";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { auditLogService } from "@/server/services/audit-log.service";
import { activityService } from "@/server/services/activity.service";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

export async function upsertMedicalProfileAction(clientId: string, input: MedicalProfileSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MEDICAL_PROFILE_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  const validated = medicalProfileSchema.parse(input);

  const existing = await db.query.clientMedicalProfiles.findFirst({
    where: eq(clientMedicalProfiles.clientId, clientId),
  });

  if (existing) {
    await db.update(clientMedicalProfiles)
      .set({
        ...validated,
        updatedAt: new Date(),
      })
      .where(eq(clientMedicalProfiles.clientId, clientId));
  } else {
    await db.insert(clientMedicalProfiles)
      .values({
        ...validated,
        clientId,
      });
  }

  await activityService.create({
    studioId,
    clientId,
    userId: session.user.id,
    type: "medical_profile_updated",
    title: "Мед. профиль обновлен",
    description: "Информация о состоянии здоровья клиента была обновлена",
  });

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "medical_profile_updated",
    entityType: "medical_profile",
    entityId: clientId,
    metadata: validated,
  });

  revalidatePath(`/clients/${clientId}`);
}
