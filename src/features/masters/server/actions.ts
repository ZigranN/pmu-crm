"use server";
import { writeAudit } from "@/server/services/audit-log.service";
import { lockStudioAccess } from "@/server/auth/scopes";
import { hasPermission } from "@/lib/permissions";

import { db } from "@/db";
import { masters, masterServices, services } from "@/db/schema";
import { masterSchema, type MasterSchema } from "../schemas/master.schema";
import { requireStudioPermission } from "@/server/auth/context";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { revalidatePath } from "next/cache";
import { eq, and, inArray, asc } from "drizzle-orm";

async function validateServices(tx: Transaction, studioId: string, ids: string[], existing: string[] = []) {
  if (!ids.length) return;
  const rows = await tx.select().from(services).where(and(
    eq(services.studioId, studioId), inArray(services.id, ids),
  )).orderBy(asc(services.id)).for("share");
  if (rows.length !== ids.length || rows.some((row) =>
    (!row.isActive || row.deletedAt) && !existing.includes(row.id))) {
    throw new Error("Service not available in this studio");
  }
}

export async function createMasterAction(input: MasterSchema) {
  const { studioId, userId } = await requireStudioPermission("MASTER_CREATE");
  const { serviceIds = [], ...masterData } = masterSchema.parse(input);
  const master = await db.transaction(async (tx) => {
    await lockStudioAccess(tx, { studioId, userId });
    if (!await hasPermission(tx, userId, studioId, "MASTER_CREATE")) throw new Error("Permission denied");
    await validateServices(tx, studioId, serviceIds);
    const [created] = await tx.insert(masters).values({ ...masterData, studioId }).returning();
    if (serviceIds.length) await tx.insert(masterServices).values(serviceIds.map((serviceId) => ({ studioId, masterId: created.id, serviceId })));
    await writeAudit(tx, { studioId, userId, action: "master_created", entityType: "master", entityId: created.id, before: null, after: { ...created, serviceIds }, reason: "command:master_created" });
    return created;
  });
  revalidatePath("/masters");
  return master;
}

export async function updateMasterAction(id: string, input: MasterSchema) {
  const { studioId, userId } = await requireStudioPermission("MASTER_UPDATE");
  entityId.parse(id);
  const { serviceIds, ...masterData } = masterSchema.parse(input);
  const master = await db.transaction(async (tx) => {
    await lockStudioAccess(tx, { studioId, userId });
    if (!await hasPermission(tx, userId, studioId, "MASTER_UPDATE")) throw new Error("Permission denied");
    const [before] = await tx.select().from(masters).where(and(eq(masters.id, id), eq(masters.studioId, studioId))).for("update");
    if (!before || before.deletedAt) throw new Error("Master not found");
    const links = await tx.select().from(masterServices).where(and(eq(masterServices.masterId, id), eq(masterServices.studioId, studioId)));
    if (serviceIds !== undefined) await validateServices(tx, studioId, serviceIds, links.map((l) => l.serviceId));
    const [updated] = await tx.update(masters).set({ ...masterData, updatedAt: new Date() })
      .where(and(eq(masters.id, id), eq(masters.studioId, studioId))).returning();
    if (!updated) throw new Error("Master not found");
    // Omitted means preserve; an explicit empty array means remove all links.
    if (serviceIds !== undefined) {
      await tx.delete(masterServices).where(and(eq(masterServices.masterId, id), eq(masterServices.studioId, studioId)));
      if (serviceIds.length) await tx.insert(masterServices).values(serviceIds.map((serviceId) => ({ studioId, masterId: id, serviceId })));
    }
    await writeAudit(tx, { studioId, userId, action: "master_updated", entityType: "master", entityId: id,
      before: { ...before, serviceIds: links.map(l => l.serviceId) }, after: { ...updated, serviceIds: serviceIds ?? links.map(l => l.serviceId) }, reason: "command:master_updated" });
    return updated;
  });
  revalidatePath("/masters");
  revalidatePath(`/masters/${id}`);
  return master;
}

async function changeArchiveState(id: string, archived: boolean) {
  const { studioId, userId } = await requireStudioPermission(archived ? "MASTER_ARCHIVE" : "MASTER_UPDATE");
  entityId.parse(id);
  await db.transaction(async (tx) => {
    await lockStudioAccess(tx, { studioId, userId });
    if (!await hasPermission(tx, userId, studioId, archived ? "MASTER_ARCHIVE" : "MASTER_UPDATE")) throw new Error("Permission denied");
    const [before] = await tx.select().from(masters).where(and(eq(masters.id, id), eq(masters.studioId, studioId))).for("update");
    if (!before) throw new Error("Master not found");
    const [updated] = await tx.update(masters).set({ isActive: !archived, deletedAt: archived ? new Date() : null,
      deletedById: archived ? userId : null, updatedAt: new Date() })
      .where(and(eq(masters.id, id), eq(masters.studioId, studioId))).returning();
    if (!updated) throw new Error("Master not found");
    await writeAudit(tx, { studioId, userId, action: archived ? "master_archived" : "master_restored", entityType: "master", entityId: id, before, after: updated, reason: archived ? "command:master_archived" : "command:master_restored" });
  });
  revalidatePath("/masters");
  revalidatePath(`/masters/${id}`);
}

export async function archiveMasterAction(id: string) { await changeArchiveState(id, true); }
export async function restoreMasterAction(id: string) { await changeArchiveState(id, false); }
