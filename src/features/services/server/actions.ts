"use server";

import { db } from "@/db";
import { services } from "@/db/schema";
import { serviceSchema, type ServiceSchema } from "../schemas/service.schema";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { auditLogService } from "@/server/services/audit-log.service";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";

export async function createServiceAction(input: ServiceSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canCreate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SERVICE_CREATE);
  if (!canCreate) throw new Error("Permission denied");

  const validated = serviceSchema.parse(input);

  const [newService] = await db.insert(services).values({
    ...validated,
    studioId,
    priceCents: Math.round(validated.price * 100),
    category: validated.category as any,
    procedureType: validated.procedureType as any,
  }).returning();

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "service_created",
    entityType: "service",
    entityId: newService.id,
    metadata: validated,
  });

  revalidatePath("/services");
  return newService;
}

export async function updateServiceAction(id: string, input: ServiceSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SERVICE_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  const validated = serviceSchema.parse(input);

  const [updatedService] = await db.update(services)
    .set({
      ...validated,
      priceCents: Math.round(validated.price * 100),
      category: validated.category as any,
      procedureType: validated.procedureType as any,
      updatedAt: new Date(),
    })
    .where(and(eq(services.id, id), eq(services.studioId, studioId)))
    .returning();

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "service_updated",
    entityType: "service",
    entityId: id,
    metadata: validated,
  });

  revalidatePath("/services");
  revalidatePath(`/services/${id}`);
  return updatedService;
}

export async function archiveServiceAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canArchive = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SERVICE_ARCHIVE || "SERVICE_UPDATE");
  if (!canArchive) throw new Error("Permission denied");

  await db.update(services)
    .set({
      isActive: false,
      deletedAt: new Date(),
      deletedById: session.user.id,
    })
    .where(and(eq(services.id, id), eq(services.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "service_archived",
    entityType: "service",
    entityId: id,
  });

  revalidatePath("/services");
}

export async function restoreServiceAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.SERVICE_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  await db.update(services)
    .set({
      isActive: true,
      deletedAt: null,
      deletedById: null,
    })
    .where(and(eq(services.id, id), eq(services.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "service_restored",
    entityType: "service",
    entityId: id,
  });

  revalidatePath("/services");
}
