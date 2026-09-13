import "server-only";
import { hasPermission, type PermissionCode } from "@/lib/permissions";
import { lockStudioAccess, resourceScope } from "@/server/auth/scopes";
import { db } from "@/db";
import { clients, appointments, procedureSessions } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const entityId = z.string().uuid();

export async function lockClient(tx: Transaction, clientId: string, studioId: string, userId: string, includeArchived = false, permission?: PermissionCode) {
  entityId.parse(clientId);
  const context = await lockStudioAccess(tx, { studioId, userId });
  if (permission && !await hasPermission(tx, context.userId, studioId, permission)) throw new Error("Permission denied");
  const scope = await resourceScope(context, tx);
  const [client] = await tx.select().from(clients).where(and(
    eq(clients.id, clientId), scope.client, includeArchived ? undefined : isNull(clients.deletedAt),
  )).for("update");
  if (!client) throw new Error("Client not found");
  return client;
}

export async function validateMediaLinks(tx: Transaction, input: {
  clientId: string; studioId: string; createdById: string; type?: string; appointmentId?: string; procedureSessionId?: string;
}) {
  await lockClient(tx, input.clientId, input.studioId, input.createdById, false, input.type === "consent" ? "CONSENT_UPLOAD" : "MEDIA_CREATE");
  const context = await lockStudioAccess(tx, { studioId: input.studioId, userId: input.createdById });
  const scope = await resourceScope(context, tx);
  if (input.appointmentId) {
    entityId.parse(input.appointmentId);
    const [appointment] = await tx.select().from(appointments).where(and(
      eq(appointments.id, input.appointmentId),
      scope.isMaster ? scope.ownsMaster(sql`${appointments.masterId}`) : undefined, eq(appointments.clientId, input.clientId),
      eq(appointments.studioId, input.studioId), isNull(appointments.deletedAt),
    )).for("share");
    if (!appointment) throw new Error("Appointment not found");
  }
  if (input.procedureSessionId) {
    entityId.parse(input.procedureSessionId);
    const [procedure] = await tx.select().from(procedureSessions).where(and(
      eq(procedureSessions.id, input.procedureSessionId),
      scope.isMaster ? scope.ownsMaster(sql`${procedureSessions.masterId}`) : undefined, eq(procedureSessions.clientId, input.clientId),
      eq(procedureSessions.studioId, input.studioId), isNull(procedureSessions.deletedAt),
    )).for("share");
    if (!procedure || (input.appointmentId && procedure.appointmentId !== input.appointmentId)) {
      throw new Error("Procedure session not found");
    }
  }
}
