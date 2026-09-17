import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { sensitiveRead, recordIds, optionalRecordId } from "@/server/services/access-log.service";
import { resourceScope } from "@/server/auth/scopes";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { clients, clientMedicalProfiles, activityEvents, masters } from "@/db/schema";
import { eq, and, isNull, ilike, or, desc, ne, SQL, sql } from "drizzle-orm";

export async function getClients(studioId: string, filters?: { search?: string, status?: any }) {
  return sensitiveRead("CLIENT_READ", studioId, { operation: "clients.list" }, async (context) => {
    const scope = await resourceScope(context);
    const conditions = [
      scope.client,
      isNull(clients.deletedAt),
    ];

    if (filters?.status && filters.status !== "all") {
      conditions.push(eq(clients.clientStatus, filters.status));
    }

    if (filters?.search) {
      const searchPattern = `%${filters.search}%`;
      const searchConditions = [
        ilike(clients.firstName, searchPattern),
        ilike(clients.lastName, searchPattern),
        ilike(clients.fullName, searchPattern),
        ilike(clients.phone, searchPattern),
        ilike(clients.whatsapp, searchPattern)
      ].filter(Boolean) as SQL[];

      conditions.push(or(...searchConditions)!);
    }

    const rows = await db.query.clients.findMany({
      where: and(...conditions),
      orderBy: [desc(clients.createdAt)],
    });
    return rows.map(row => ({ ...row, ltvCents: scope.isMaster ? null : row.ltvCents }));
  }, recordIds);
}

export async function getClientById(id: string, studioId: string) {
  return sensitiveRead("CLIENT_READ", studioId, { operation: "client.read", targetId: id }, async (context) => {
    const scope = await resourceScope(context);
    // Note: Simplified to avoid Drizzle relations issues
    // Medical profile and activity events fetched separately if needed
    const row = await db.query.clients.findFirst({
      where: and(
        eq(clients.id, id),
        scope.client,
        isNull(clients.deletedAt)
      )
    });
    return row ? { ...row, ltvCents: scope.isMaster ? null : row.ltvCents } : undefined;
  }, optionalRecordId);
}

export async function getClientMedicalProfile(id: string, studioId: string) {
  return sensitiveRead("MEDICAL_PROFILE_READ", studioId, { operation: "medical.read", targetId: id }, async (context) => {
    const scope = await resourceScope(context);
    const client = await getClientById(id, studioId);
    if (!client) return undefined;
    return db.query.clientMedicalProfiles.findFirst({ where: and(eq(clientMedicalProfiles.clientId, client.id), scope.clientReference(sql`${clientMedicalProfiles.clientId}`)) });
  }, optionalRecordId);
}

export async function getClientActivity(id: string, studioId: string) {
  return sensitiveRead("CLIENT_READ", studioId, { operation: "activity.read", targetId: id }, async (context) => {
    const client = await getClientById(id, studioId);
    if (!client) return [];
    const scope = await resourceScope(context);
    const medicalRead = await hasPermission(db, context.userId, studioId, "MEDICAL_PROFILE_READ");
    return db.query.activityEvents.findMany({
      where: and(scope.clientReference(sql`${activityEvents.clientId}`), eq(activityEvents.clientId, client.id), eq(activityEvents.studioId, studioId),
        medicalRead ? undefined : ne(activityEvents.type, "medical_profile_updated")),
      orderBy: [desc(activityEvents.createdAt)], limit: 20,
    });
  }, recordIds);
}

// Only display names attached to an already authorized client, not other masters' profiles.
export async function getClientMasterLabels(id: string, studioId: string) {
  return sensitiveRead("CLIENT_READ", studioId, { operation: "client.read", targetId: id }, async context => {
    const scope = await resourceScope(context), assigned = alias(masters, "assigned"), preferred = alias(masters, "preferred");
    return (await db.select({ id: clients.id, assignedName: assigned.displayName, preferredName: preferred.displayName }).from(clients)
      .leftJoin(assigned, and(eq(assigned.id, clients.assignedMasterId), eq(assigned.studioId, clients.studioId)))
      .leftJoin(preferred, and(eq(preferred.id, clients.preferredMasterId), eq(preferred.studioId, clients.studioId)))
      .where(and(eq(clients.id, id), scope.client, isNull(clients.deletedAt))))[0];
  }, optionalRecordId);
}
