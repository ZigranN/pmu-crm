"use server";
import { and, eq, isNull } from "drizzle-orm";
import { clients, masters } from "@/db/schema";
import { z } from "zod";
import { requireStudioPermission } from "@/server/auth/context";
import { idempotentCommand } from "@/server/commands/idempotency";
import { lockClient } from "@/server/commands/ownership";
import { getStudioRole } from "@/lib/roles";
import { writeAudit } from "@/server/services/audit-log.service";
import { writeActivity } from "@/server/services/activity.service";
import { revalidatePath } from "next/cache";
const preferenceSchema = z.object({ clientId: z.string().uuid(), masterId: z.string().uuid().nullable(), expectedMasterId: z.string().uuid().nullable(), reason: z.string().trim().min(3).max(1000) }).strict();
export async function setPreferredMaster(input: z.infer<typeof preferenceSchema>, requestKey: string) {
  const context = await requireStudioPermission("CLIENT_UPDATE"), data = preferenceSchema.parse(input);
  await idempotentCommand(context, "CLIENT_UPDATE", "client.preferred-master.v1", requestKey, data, async tx => {
    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role !== "OWNER" && role !== "ADMIN") throw new Error("Permission denied");
    const before = await lockClient(tx, data.clientId, context.studioId, context.userId, false, "CLIENT_UPDATE");
    if (before.preferredMasterId !== data.expectedMasterId) throw new Error("Предпочтение уже изменилось. Обновите страницу");
    if (data.masterId && !(await tx.select().from(masters).where(and(eq(masters.id, data.masterId), eq(masters.studioId, context.studioId), eq(masters.isActive, true), isNull(masters.deletedAt)))).length) throw new Error("Master not found");
    if (before.preferredMasterId !== data.masterId) {
      await tx.update(clients).set({ preferredMasterId: data.masterId, updatedAt: new Date() }).where(eq(clients.id, before.id));
      await writeAudit(tx, { ...context, action: "client_preferred_master_changed", entityType: "client", entityId: before.id,
        before: { preferredMasterId: before.preferredMasterId }, after: { preferredMasterId: data.masterId }, reason: data.reason, reasonSource: "user" });
      await writeActivity(tx, { ...context, clientId: before.id, type: "client_updated", title: "Предпочтительный мастер изменён", metadata: { previousMasterId: before.preferredMasterId, masterId: data.masterId } });
    }
    return { clientId: before.id };
  }, async tx => {
    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role !== "OWNER" && role !== "ADMIN") throw new Error("Permission denied");
    await lockClient(tx, data.clientId, context.studioId, context.userId, false, "CLIENT_UPDATE");
  });
  revalidatePath(`/clients/${data.clientId}`); revalidatePath("/clients");
}
