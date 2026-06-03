import { db } from "@/db";
import { masters, masterServices } from "@/db/schema";
import { eq, and, isNull, ilike, inArray } from "drizzle-orm";

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

  const masterIds = mastersList.map(m => m.id);
  if (masterIds.length === 0) return [];

  const services = await db.query.masterServices.findMany({
    where: inArray(masterServices.masterId, masterIds),
    with: {
      service: true
    }
  } as any);

  return mastersList.map(master => ({
    ...master,
    masterServices: services.filter(s => s.masterId === master.id)
  }));
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
  const master = await db.query.masters.findFirst({
    where: and(
      eq(masters.id, id),
      eq(masters.studioId, studioId)
    ),
  });

  if (!master) return null;

  const services = await db.query.masterServices.findMany({
    where: eq(masterServices.masterId, id),
    with: {
      service: true
    }
  } as any);

  return {
    ...master,
    masterServices: services
  };
}
