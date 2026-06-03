"use server";

import { db } from "@/db";
import { masters, masterServices } from "@/db/schema";
import { masterSchema, type MasterSchema } from "../schemas/master.schema";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { auditLogService } from "@/server/services/audit-log.service";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";

export async function createMasterAction(input: MasterSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canCreate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_CREATE);
  if (!canCreate) throw new Error("Permission denied");

  const { serviceIds, ...masterData } = masterSchema.parse(input);

  const [newMaster] = await db.insert(masters).values({
    ...masterData,
    studioId,
  }).returning();

  if (serviceIds && serviceIds.length > 0) {
    await db.insert(masterServices).values(
      serviceIds.map(serviceId => ({
        studioId,
        masterId: newMaster.id,
        serviceId,
      }))
    );
  }

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "master_created",
    entityType: "master",
    entityId: newMaster.id,
    metadata: input,
  });

  revalidatePath("/masters");
  return newMaster;
}

export async function updateMasterAction(id: string, input: MasterSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  const { serviceIds, ...masterData } = masterSchema.parse(input);

  const [updatedMaster] = await db.update(masters)
    .set({
      ...masterData,
      updatedAt: new Date(),
    })
    .where(and(eq(masters.id, id), eq(masters.studioId, studioId)))
    .returning();

  // Обновляем услуги мастера
  await db.delete(masterServices).where(eq(masterServices.masterId, id));
  
  if (serviceIds && serviceIds.length > 0) {
    await db.insert(masterServices).values(
      serviceIds.map(serviceId => ({
        studioId,
        masterId: id,
        serviceId,
      }))
    );
  }

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "master_updated",
    entityType: "master",
    entityId: id,
    metadata: input,
  });

  revalidatePath("/masters");
  revalidatePath(`/masters/${id}`);
  return updatedMaster;
}

export async function archiveMasterAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canArchive = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_ARCHIVE || "MASTER_UPDATE");
  if (!canArchive) throw new Error("Permission denied");

  await db.update(masters)
    .set({
      isActive: false,
      deletedAt: new Date(),
      deletedById: session.user.id,
    })
    .where(and(eq(masters.id, id), eq(masters.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "master_archived",
    entityType: "master",
    entityId: id,
  });

  revalidatePath("/masters");
}

export async function restoreMasterAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MASTER_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  await db.update(masters)
    .set({
      isActive: true,
      deletedAt: null,
      deletedById: null,
    })
    .where(and(eq(masters.id, id), eq(masters.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "master_restored",
    entityType: "master",
    entityId: id,
  });

  revalidatePath("/masters");
}
