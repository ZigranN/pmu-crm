import { db } from "@/db";
import { masters } from "@/db/schema";
import { eq, and, isNull, ilike } from "drizzle-orm";

export async function getMasters(studioId: string, filters?: { search?: string, showArchived?: boolean }) {
  const conditions = [
    eq(masters.studioId, studioId),
  ];

  if (!filters?.showArchived) {
    conditions.push(isNull(masters.deletedAt));
    conditions.push(eq(masters.isActive, true));
  }

  if (filters?.search) {
    conditions.push(ilike(masters.displayName, `%${filters.search}%`));
  }

  const mastersList = await db.query.masters.findMany({
    where: and(...conditions),
  });

  // Note: Simplified to avoid Drizzle relations issues
  // Services can be fetched separately if needed
  return mastersList;
}

export async function getActiveMasters(studioId: string) {
  return await db.query.masters.findMany({
    where: and(
      eq(masters.studioId, studioId),
      eq(masters.isActive, true),
      isNull(masters.deletedAt)
    ),
    orderBy: (masters, { asc }) => [asc(masters.displayName)],
  });
}

export async function getMasterById(id: string, studioId: string) {
  // Note: Simplified to avoid Drizzle relations issues
  // Services can be fetched separately if needed
  return await db.query.masters.findFirst({
    where: and(
      eq(masters.id, id),
      eq(masters.studioId, studioId)
    ),
  });
}
