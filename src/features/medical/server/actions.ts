"use server";
import { writeActivity } from "@/server/services/activity.service";
import { writeAudit } from "@/server/services/audit-log.service";

import { db } from "@/db";
import { clientMedicalProfiles } from "@/db/schema";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function upsertMedicalProfileAction(clientId: string, input: MedicalProfileSchema) {
  const { studioId, userId } = await requireStudioPermission("MEDICAL_PROFILE_UPDATE");
  const validated = medicalProfileSchema.parse(input);
  await db.transaction(async (tx) => {
    await lockClient(tx, clientId, studioId, userId, false, "MEDICAL_PROFILE_UPDATE");
    const before = await tx.query.clientMedicalProfiles.findFirst({ where: eq(clientMedicalProfiles.clientId, clientId) });
    const [after] = await tx.insert(clientMedicalProfiles).values({ ...validated, clientId })
      .onConflictDoUpdate({ target: clientMedicalProfiles.clientId, set: { ...validated, updatedAt: new Date() } }).returning();
    await writeActivity(tx, { studioId, clientId, userId, type: "medical_profile_updated",
      title: "Мед. профиль обновлен", description: "Медицинская анкета клиента была обновлена" });
    await writeAudit(tx, { studioId, userId, action: "medical_profile_updated", entityType: "client_medical_profile",
      entityId: clientId, before: before ?? null, after, reason: "command:medical_profile_updated", metadata: { updatedFields: Object.keys(validated) } });
  });
  revalidatePath(`/clients/${clientId}`);
}
