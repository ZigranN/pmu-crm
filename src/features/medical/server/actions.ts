"use server";

import { db } from "@/db";
import { clientMedicalProfiles, activityEvents, auditLogs } from "@/db/schema";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { revalidatePath } from "next/cache";

export async function upsertMedicalProfileAction(clientId: string, input: MedicalProfileSchema) {
  const { studioId, userId } = await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const validated = medicalProfileSchema.parse(input);
  await db.transaction(async (tx) => {
    await lockClient(tx, clientId, studioId);
    await tx.insert(clientMedicalProfiles).values({ ...validated, clientId })
      .onConflictDoUpdate({ target: clientMedicalProfiles.clientId, set: { ...validated, updatedAt: new Date() } });
    await tx.insert(activityEvents).values({ studioId, clientId, userId, type: "medical_profile_updated",
      title: "Мед. профиль обновлен", description: "Медицинская анкета клиента была обновлена" });
    await tx.insert(auditLogs).values({ studioId, userId, action: "medical_profile_updated", entityType: "client_medical_profile",
      entityId: clientId, metadata: { updatedFields: Object.keys(validated) } });
  });
  revalidatePath(`/clients/${clientId}`);
}
