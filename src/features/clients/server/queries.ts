import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and, isNull, ilike, or, desc, SQL } from "drizzle-orm";

export async function getClients(studioId: string, filters?: { search?: string, status?: any }) {
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
  // Note: Simplified to avoid Drizzle relations issues
  // Medical profile and activity events fetched separately if needed
  return await db.query.clients.findFirst({
    where: and(
      eq(clients.id, id),
      eq(clients.studioId, studioId)
    )
  });
}
