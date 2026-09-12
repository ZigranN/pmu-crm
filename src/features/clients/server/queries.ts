import "server-only";
import { requireStudioPermission } from "@/server/auth/context";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { clients, clientMedicalProfiles, activityEvents } from "@/db/schema";
import { eq, and, isNull, ilike, or, desc, ne, SQL } from "drizzle-orm";

export async function getClients(studioId: string, filters?: { search?: string, status?: any }) {
  await requireStudioPermission("CLIENT_READ", studioId);
  const conditions = [
    eq(clients.studioId, studioId),
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

  return await db.query.clients.findMany({
    where: and(...conditions),
    orderBy: [desc(clients.createdAt)],
  });
}

export async function getClientById(id: string, studioId: string) {
  await requireStudioPermission("CLIENT_READ", studioId);
  // Note: Simplified to avoid Drizzle relations issues
  // Medical profile and activity events fetched separately if needed
  return await db.query.clients.findFirst({
    where: and(
      eq(clients.id, id),
      eq(clients.studioId, studioId),
      isNull(clients.deletedAt)
    )
  });
}

export async function getClientMedicalProfile(id: string, studioId: string) {
  await requireStudioPermission("MEDICAL_PROFILE_READ", studioId);
  const client = await getClientById(id, studioId);
  if (!client) return undefined;
  return db.query.clientMedicalProfiles.findFirst({ where: eq(clientMedicalProfiles.clientId, client.id) });
}

export async function getClientActivity(id: string, studioId: string) {
  const context = await requireStudioPermission("CLIENT_READ", studioId);
  const client = await getClientById(id, studioId);
  if (!client) return [];
  const medicalRead = await hasPermission(db, context.userId, studioId, "MEDICAL_PROFILE_READ");
  return db.query.activityEvents.findMany({
    where: and(eq(activityEvents.clientId, client.id), eq(activityEvents.studioId, studioId),
      medicalRead ? undefined : ne(activityEvents.type, "medical_profile_updated")),
    orderBy: [desc(activityEvents.createdAt)], limit: 20,
  });
}
