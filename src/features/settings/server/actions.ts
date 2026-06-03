"use server";

import { db } from "@/db";
import { studios } from "@/db/schema";
import { studioSettingsSchema, type StudioSettingsSchema } from "../schemas/studio-settings.schema";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { auditLogService } from "@/server/services/audit-log.service";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

export async function updateStudioSettingsAction(input: StudioSettingsSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SETTINGS_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  const validated = studioSettingsSchema.parse(input);

  await db.update(studios)
    .set({
      ...validated,
      updatedAt: new Date(),
    })
    .where(eq(studios.id, studioId));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "studio_settings_updated",
    entityType: "studio",
    entityId: studioId,
    metadata: validated,
  });

  revalidatePath("/settings/studio");
}
