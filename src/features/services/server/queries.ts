import "server-only";
import { requireAuthenticatedUser, requireStudioPermissionFor } from "@/server/auth/context";
import { db } from "@/db";
import { services } from "@/db/schema";
import { eq, and, isNull, ilike } from "drizzle-orm";

async function checkServicePermission(studioId: string) {
  const user = await requireAuthenticatedUser();
  try {
    await requireStudioPermissionFor(user.id, studioId, "SERVICE_READ");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "STUDIO_ACCESS_DENIED" ||
        error.name === "StudioAccessDeniedError" ||
        error.message === "FORBIDDEN_PERMISSION" ||
        error.name === "ForbiddenPermissionError")
    ) {
      throw new Error("Permission denied");
    }
    throw error;
  }
}

export async function getServices(studioId: string, filters?: { search?: string, showArchived?: boolean }) {
  await checkServicePermission(studioId);
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
  await checkServicePermission(studioId);
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
  await checkServicePermission(studioId);
  return await db.query.services.findFirst({
    where: and(
      eq(services.id, id),
      eq(services.studioId, studioId)
    ),
  });
}

export async function getCatalogOptions(studioId: string) {
  await checkServicePermission(studioId);
  const { serviceDefinitions, whatsappTemplates } = await import("@/db/schema");
  const definitions = await db.select().from(serviceDefinitions).orderBy(serviceDefinitions.name);
  const templates = await db.select({ id: whatsappTemplates.id, name: whatsappTemplates.name, category: whatsappTemplates.category }).from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.studioId, studioId), eq(whatsappTemplates.isActive, true), isNull(whatsappTemplates.deletedAt)));
  return { definitions, templates };
}
// Future booking commands must use the reviewed catalog, then separately resolve quote/offer policy.
export async function getBookableServices(studioId: string) {
  await checkServicePermission(studioId);
  return db.select().from(services).where(and(eq(services.studioId, studioId), eq(services.catalogVersion, 1), eq(services.isActive, true), isNull(services.deletedAt)));
}
