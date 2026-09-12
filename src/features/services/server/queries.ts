import "server-only";
import { requireStudioPermission } from "@/server/auth/context";
import { db } from "@/db";
import { services } from "@/db/schema";
import { eq, and, isNull, ilike } from "drizzle-orm";

export async function getServices(studioId: string, filters?: { search?: string, showArchived?: boolean }) {
  await requireStudioPermission("SERVICE_READ", studioId);
  const conditions = [
    eq(services.studioId, studioId),
  ];

  if (!filters?.showArchived) {
    conditions.push(isNull(services.deletedAt));
    conditions.push(eq(services.isActive, true));
  }

  if (filters?.search) {
    conditions.push(ilike(services.name, `%${filters.search}%`));
  }

  return await db.query.services.findMany({
    where: and(...conditions),
    orderBy: (services, { asc }) => [asc(services.name)],
  });
}

export async function getActiveServices(studioId: string) {
  await requireStudioPermission("SERVICE_READ", studioId);
  return await db.query.services.findMany({
    where: and(
      eq(services.studioId, studioId),
      eq(services.isActive, true),
      isNull(services.deletedAt)
    ),
    orderBy: (services, { asc }) => [asc(services.name)],
  });
}

export async function getServiceById(id: string, studioId: string) {
  await requireStudioPermission("SERVICE_READ", studioId);
  return await db.query.services.findFirst({
    where: and(
      eq(services.id, id),
      eq(services.studioId, studioId)
    ),
  });
}
