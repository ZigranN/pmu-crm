"use server";
import { resourceScope } from "@/server/auth/scopes";

import { requireStudioContext, requireStudioPermission } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { clients, services, masters } from "@/db/schema";
import { eq, and, isNull, ilike, or, sql } from "drizzle-orm";

export async function searchClientsAction(studioId: string, query: string) {
  const context = await requireStudioPermission("CLIENT_READ", studioId);
  const scope = await resourceScope(context);
  if (!query || query.length < 2) return [];

  const searchPattern = `%${query}%`;

  const rows = await db.query.clients.findMany({
    where: and(
      scope.client,
      isNull(clients.deletedAt),
      or(
        ilike(clients.firstName, searchPattern),
        ilike(clients.lastName, searchPattern),
        ilike(clients.fullName, searchPattern),
        ilike(clients.phone, searchPattern),
        ilike(clients.whatsapp, searchPattern),
        ilike(clients.email, searchPattern),
        ilike(clients.instagram, searchPattern)
      )
    ),
    limit: 20,
  });
  return rows.map(row => ({ ...row, ltvCents: scope.isMaster ? null : row.ltvCents }));
}

export async function globalSearchAction(studioId: string, query: string) {
  const context = await requireStudioContext(studioId);
  const scope = await resourceScope(context);
  const [readClients, readServices, readMasters] = await Promise.all(
    (["CLIENT_READ", "SERVICE_READ", "MASTER_READ"] as const).map(
      (permission) => hasPermission(db, context.userId, context.studioId, permission)
    )
  );
  if (!query || query.length < 2) return { clients: [], services: [], masters: [] };

  const searchPattern = `%${query}%`;

  const foundClients = readClients ? await db.query.clients.findMany({
    where: and(
      scope.client,
      isNull(clients.deletedAt),
      or(
        ilike(clients.firstName, searchPattern),
        ilike(clients.lastName, searchPattern),
        ilike(clients.fullName, searchPattern),
        ilike(clients.phone, searchPattern),
        ilike(clients.whatsapp, searchPattern),
        ilike(clients.email, searchPattern),
        ilike(clients.instagram, searchPattern)
      )
    ),
    limit: 5,
  }) : [];

  const foundServices = readServices ? await db.query.services.findMany({
    where: and(
      eq(services.studioId, studioId),
      isNull(services.deletedAt),
      eq(services.isActive, true),
      or(
        ilike(services.name, searchPattern),
        ilike(sql`${services.category}::text`, searchPattern)
      )
    ),
    limit: 5,
  }) : [];

  const foundMasters = readMasters ? await db.query.masters.findMany({
    where: and(
      scope.master,
      isNull(masters.deletedAt),
      eq(masters.isActive, true),
      or(
        ilike(masters.displayName, searchPattern),
        ilike(masters.phone, searchPattern),
        ilike(masters.email, searchPattern)
      )
    ),
    limit: 5,
  }) : [];

  return {
    clients: foundClients.map(row => ({ ...row, ltvCents: scope.isMaster ? null : row.ltvCents })),
    services: foundServices,
    masters: foundMasters,
  };
}
