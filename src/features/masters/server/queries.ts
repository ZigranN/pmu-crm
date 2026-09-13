import "server-only";
import { resourceScope } from "@/server/auth/scopes";
import { requireStudioPermission } from "@/server/auth/context";
import { db } from "@/db";
import { masters, masterServices } from "@/db/schema";
import { eq, and, isNull, ilike } from "drizzle-orm";

export async function getMasters(studioId: string, filters?: { search?: string, showArchived?: boolean }) {
  const context = await requireStudioPermission("MASTER_READ", studioId);
  const scope = await resourceScope(context);
  const conditions = [
    scope.master,
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
  const context = await requireStudioPermission("MASTER_READ", studioId);
  const scope = await resourceScope(context);
  return await db.query.masters.findMany({
    where: and(
      scope.master,
      eq(masters.isActive, true),
      isNull(masters.deletedAt)
    ),
    orderBy: (masters, { asc }) => [asc(masters.displayName)],
  });
}

export async function getMasterById(id: string, studioId: string) {
  const context = await requireStudioPermission("MASTER_READ", studioId);
  const scope = await resourceScope(context);
  const master = await db.query.masters.findFirst({
    where: and(eq(masters.id, id), scope.master),
  });
  if (!master) return undefined;
  const links = await db.query.masterServices.findMany({
    where: and(eq(masterServices.masterId, master.id), eq(masterServices.studioId, studioId)),
  });
  return { ...master, services: links };
}
