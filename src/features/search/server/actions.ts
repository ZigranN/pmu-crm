"use server";

import { db } from "@/db";
import { clients, services, masters } from "@/db/schema";
import { eq, and, isNull, ilike, or } from "drizzle-orm";

export async function searchClientsAction(studioId: string, query: string) {
  if (!query || query.length < 2) return [];

  const searchPattern = `%${query}%`;

  return await db.query.clients.findMany({
    where: and(
      eq(clients.studioId, studioId),
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
}

export async function globalSearchAction(studioId: string, query: string) {
  if (!query || query.length < 2) return { clients: [], services: [], masters: [] };

  const searchPattern = `%${query}%`;

  const foundClients = await db.query.clients.findMany({
    where: and(
      eq(clients.studioId, studioId),
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
  });

  const foundServices = await db.query.services.findMany({
    where: and(
      eq(services.studioId, studioId),
      isNull(services.deletedAt),
      eq(services.isActive, true),
      or(
        ilike(services.name, searchPattern),
        ilike(services.category, searchPattern)
      )
    ),
    limit: 5,
  });

  const foundMasters = await db.query.masters.findMany({
    where: and(
      eq(masters.studioId, studioId),
      isNull(masters.deletedAt),
      eq(masters.isActive, true),
      or(
        ilike(masters.displayName, searchPattern),
        ilike(masters.phone, searchPattern),
        ilike(masters.email, searchPattern)
      )
    ),
    limit: 5,
  });

  return {
    clients: foundClients,
    services: foundServices,
    masters: foundMasters,
  };
}
