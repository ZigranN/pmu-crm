"use server";
import { studios, auditLogs } from "@/db/schema";
import { studioSettingsSchema, type StudioSettingsSchema } from "../schemas/studio-settings.schema";
import { withStudioCommand } from "@/server/auth/scopes";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
export async function updateStudioSettingsAction(input: StudioSettingsSchema) {
  const validated = studioSettingsSchema.parse(input);
  await withStudioCommand("SETTINGS_UPDATE", async (tx, context) => {
    await tx.update(studios).set({ ...validated, updatedAt: new Date() }).where(eq(studios.id, context.studioId));
    await tx.insert(auditLogs).values({ ...context, action: "studio_settings_updated", entityType: "studio", entityId: context.studioId, metadata: validated });
  });
  revalidatePath("/settings/studio");
}
