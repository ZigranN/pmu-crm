import "server-only";
import { resourceScope } from "@/server/auth/scopes";
import { requireStudioPermission } from "@/server/auth/context";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { clients, clientMedicalProfiles, activityEvents } from "@/db/schema";
import { eq, and, isNull, ilike, or, desc, ne, SQL, sql } from "drizzle-orm";

export async function getClients(studioId: string, filters?: { search?: string, status?: any }) {
  const context = await requireStudioPermission("CLIENT_READ", studioId);
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
}

export async function getClientById(id: string, studioId: string) {
  const context = await requireStudioPermission("CLIENT_READ", studioId);
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
}

export async function getClientMedicalProfile(id: string, studioId: string) {
  const context = await requireStudioPermission("MEDICAL_PROFILE_READ", studioId);
  const scope = await resourceScope(context);
  const client = await getClientById(id, studioId);
  if (!client) return undefined;
  return db.query.clientMedicalProfiles.findFirst({ where: and(eq(clientMedicalProfiles.clientId, client.id), scope.clientReference(sql`${clientMedicalProfiles.clientId}`)) });
}

export async function getClientActivity(id: string, studioId: string) {
  const context = await requireStudioPermission("CLIENT_READ", studioId);
  const client = await getClientById(id, studioId);
  if (!client) return [];
  const scope = await resourceScope(context);
  const medicalRead = await hasPermission(db, context.userId, studioId, "MEDICAL_PROFILE_READ");
  return db.query.activityEvents.findMany({
    where: and(scope.clientReference(sql`${activityEvents.clientId}`), eq(activityEvents.clientId, client.id), eq(activityEvents.studioId, studioId),
      medicalRead ? undefined : ne(activityEvents.type, "medical_profile_updated")),
    orderBy: [desc(activityEvents.createdAt)], limit: 20,
  });
}
