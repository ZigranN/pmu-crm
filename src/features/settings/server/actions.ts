"use server";
import { writeAudit } from "@/server/services/audit-log.service";
import { studios } from "@/db/schema";
import { studioSettingsSchema, type StudioSettingsSchema } from "../schemas/studio-settings.schema";
import { withStudioCommand } from "@/server/auth/scopes";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
export async function updateStudioSettingsAction(input: StudioSettingsSchema) {
  const validated = studioSettingsSchema.parse(input);
  await withStudioCommand("SETTINGS_UPDATE", async (tx, context) => {
    const [before] = await tx.select().from(studios).where(eq(studios.id, context.studioId));
    const [after] = await tx.update(studios).set({ ...validated, updatedAt: new Date() }).where(eq(studios.id, context.studioId)).returning();
    await writeAudit(tx, { ...context, action: "studio_settings_updated", entityType: "studio", entityId: context.studioId, before, after, reason: "command:studio_settings_updated" });
  });
  revalidatePath("/settings/studio");
}
