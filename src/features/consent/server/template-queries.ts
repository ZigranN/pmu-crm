import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { consentTemplates, consentTemplateVersions } from "@/db/schema";
import { entityId, type Transaction } from "@/server/commands/ownership";

type Executor = typeof db | Transaction;

export type ConsentTemplate = typeof consentTemplates.$inferSelect;
export type ConsentTemplateVersion = typeof consentTemplateVersions.$inferSelect;

export interface ListConsentTemplatesOptions {
  includeArchived?: boolean;
}

/**
 * Retrieves a logical consent template strictly scoped by studio ID.
 */
export async function getConsentTemplateById(
  studioId: string,
  templateId: string,
  executor: Executor = db
): Promise<ConsentTemplate | null> {
  entityId.parse(studioId);
  entityId.parse(templateId);

  const [row] = await executor
    .select()
    .from(consentTemplates)
    .where(
      and(
        eq(consentTemplates.id, templateId),
        eq(consentTemplates.studioId, studioId)
      )
    )
    .limit(1);

  return row ?? null;
}

/**
 * Retrieves a consent template version strictly scoped by studio ID.
 */
export async function getConsentTemplateVersionById(
  studioId: string,
  versionId: string,
  executor: Executor = db
): Promise<ConsentTemplateVersion | null> {
  entityId.parse(studioId);
  entityId.parse(versionId);

  const [row] = await executor
    .select()
    .from(consentTemplateVersions)
    .where(
      and(
        eq(consentTemplateVersions.id, versionId),
        eq(consentTemplateVersions.studioId, studioId)
      )
    )
    .limit(1);

  return row ?? null;
}

/**
 * Lists consent templates for a studio.
 * By default excludes archived templates unless includeArchived is set to true.
 * Ordered deterministically by createdAt asc, code asc.
 */
export async function listConsentTemplates(
  studioId: string,
  options: ListConsentTemplatesOptions = {},
  executor: Executor = db
): Promise<ConsentTemplate[]> {
  entityId.parse(studioId);

  const conditions = [eq(consentTemplates.studioId, studioId)];
  if (!options.includeArchived) {
    conditions.push(isNull(consentTemplates.archivedAt));
  }

  return executor
    .select()
    .from(consentTemplates)
    .where(and(...conditions))
    .orderBy(asc(consentTemplates.createdAt), asc(consentTemplates.code));
}

/**
 * Lists all versions for a given consent template, strictly scoped by studio ID.
 * Ordered deterministically by versionNumber asc.
 */
export async function listConsentTemplateVersions(
  studioId: string,
  templateId: string,
  executor: Executor = db
): Promise<ConsentTemplateVersion[]> {
  entityId.parse(studioId);
  entityId.parse(templateId);

  return executor
    .select()
    .from(consentTemplateVersions)
    .where(
      and(
        eq(consentTemplateVersions.templateId, templateId),
        eq(consentTemplateVersions.studioId, studioId)
      )
    )
    .orderBy(asc(consentTemplateVersions.versionNumber));
}
