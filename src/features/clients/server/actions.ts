"use server";

import { db } from "@/db";
import { clients, clientStatusHistory } from "@/db/schema";
import { clientSchema, type ClientSchema } from "../schemas/client.schema";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { auditLogService } from "@/server/services/audit-log.service";
import { activityService } from "@/server/services/activity.service";
import { normalizePhone } from "@/lib/phone";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";

export async function createClientAction(input: ClientSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canCreate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CLIENT_CREATE);
  if (!canCreate) throw new Error("Permission denied");

  const validated = clientSchema.parse(input);
  
  const phone = normalizePhone(validated.phone);
  const whatsapp = validated.whatsapp ? normalizePhone(validated.whatsapp) : phone;
  const fullName = `${validated.firstName} ${validated.lastName || ""}`.trim();

  const [newClient] = await db.insert(clients).values({
    ...validated,
    studioId,
    phone,
    whatsapp,
    fullName,
    clientStatus: validated.clientStatus as any,
    tags: Array.isArray(validated.tags) ? validated.tags.join(",") : validated.tags,
  }).returning();

  await activityService.create({
    studioId,
    clientId: newClient.id,
    userId: session.user.id,
    type: "client_created",
    title: "Клиент создан",
    description: `Клиент ${fullName} добавлен в систему`,
  });

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "client_created",
    entityType: "client",
    entityId: newClient.id,
    metadata: validated,
  });

  revalidatePath("/clients");
  return newClient;
}

export async function updateClientAction(id: string, input: ClientSchema) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CLIENT_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  const validated = clientSchema.parse(input);
  
  const phone = normalizePhone(validated.phone);
  const whatsapp = validated.whatsapp ? normalizePhone(validated.whatsapp) : phone;
  const fullName = `${validated.firstName} ${validated.lastName || ""}`.trim();

  const oldClient = await db.query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.studioId, studioId)),
  });

  const [updatedClient] = await db.update(clients)
    .set({
      ...validated,
      phone,
      whatsapp,
      fullName,
      clientStatus: validated.clientStatus as any,
      tags: Array.isArray(validated.tags) ? validated.tags.join(",") : validated.tags,
      updatedAt: new Date(),
    })
    .where(and(eq(clients.id, id), eq(clients.studioId, studioId)))
    .returning();

  if (oldClient && oldClient.clientStatus !== validated.clientStatus) {
    await db.insert(clientStatusHistory).values({
      studioId,
      clientId: id,
      oldStatus: oldClient.clientStatus,
      newStatus: validated.clientStatus,
      changedById: session.user.id,
    });

    await activityService.create({
      studioId,
      clientId: id,
      userId: session.user.id,
      type: "client_status_changed",
      title: "Статус изменен",
      description: `Статус изменен с ${oldClient.clientStatus} на ${validated.clientStatus}`,
    });
  }

  await activityService.create({
    studioId,
    clientId: id,
    userId: session.user.id,
    type: "client_updated",
    title: "Данные обновлены",
    description: "Личные данные клиента были обновлены",
  });

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "client_updated",
    entityType: "client",
    entityId: id,
    metadata: validated,
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return updatedClient;
}

export async function archiveClientAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canArchive = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CLIENT_ARCHIVE || "CLIENT_UPDATE");
  if (!canArchive) throw new Error("Permission denied");

  await db.update(clients)
    .set({
      deletedAt: new Date(),
      deletedById: session.user.id,
    })
    .where(and(eq(clients.id, id), eq(clients.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "client_archived",
    entityType: "client",
    entityId: id,
  });

  revalidatePath("/clients");
}

export async function restoreClientAction(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpdate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CLIENT_UPDATE);
  if (!canUpdate) throw new Error("Permission denied");

  await db.update(clients)
    .set({
      deletedAt: null,
      deletedById: null,
    })
    .where(and(eq(clients.id, id), eq(clients.studioId, studioId)));

  await auditLogService.create({
    studioId,
    userId: session.user.id,
    action: "client_restored",
    entityType: "client",
    entityId: id,
  });

  revalidatePath("/clients");
}
