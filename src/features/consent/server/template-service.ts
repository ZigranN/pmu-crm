import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { consentTemplates, consentTemplateVersions } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";
import { computeCanonicalTemplateHash } from "./canonical-hash";
import {
  archiveConsentTemplateSchema,
  createConsentTemplateDraftVersionSchema,
  createConsentTemplateSchema,
  publishConsentTemplateVersionSchema,
  updateConsentTemplateDraftVersionSchema,
  type ArchiveConsentTemplateInput,
  type CreateConsentTemplateDraftVersionInput,
  type CreateConsentTemplateInput,
  type PublishConsentTemplateVersionInput,
  type UpdateConsentTemplateDraftVersionInput,
} from "../schemas/template.schema";

export interface TemplateContext {
  studioId: string;
  userId: string;
}

export const templateService = {
  /**
   * Creates a logical consent template record for a studio.
   */
  async createTemplate(
    tx: Transaction,
    context: TemplateContext,
    rawInput: CreateConsentTemplateInput
  ) {
    const input = createConsentTemplateSchema.parse(rawInput);
    const code = input.code.trim();
    const name = input.name.trim();
    const description = input.description ? input.description.trim() : null;

    const [existing] = await tx
      .select({ id: consentTemplates.id })
      .from(consentTemplates)
      .where(
        and(
          eq(consentTemplates.studioId, context.studioId),
          eq(consentTemplates.code, code)
        )
      );

    if (existing) {
      throw new Error("Consent template with this code already exists in this studio");
    }

    const [created] = await tx
      .insert(consentTemplates)
      .values({
        studioId: context.studioId,
        code,
        name,
        description,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "consent_template_created",
      entityType: "consent_template",
      entityId: created.id,
      before: null,
      after: {
        id: created.id,
        code: created.code,
        name: created.name,
        description: created.description,
      },
      reason: "command:consent_template_created",
    });

    return created;
  },

  /**
   * Logically archives a consent template.
   */
  async archiveTemplate(
    tx: Transaction,
    context: TemplateContext,
    rawInput: ArchiveConsentTemplateInput
  ) {
    const input = archiveConsentTemplateSchema.parse(rawInput);

    const [template] = await tx
      .select()
      .from(consentTemplates)
      .where(
        and(
          eq(consentTemplates.id, input.templateId),
          eq(consentTemplates.studioId, context.studioId)
        )
      )
      .for("update");

    if (!template) {
      throw new Error("Consent template not found");
    }

    if (template.archivedAt !== null) {
      return template;
    }

    const now = new Date();
    const [archived] = await tx
      .update(consentTemplates)
      .set({ archivedAt: now })
      .where(
        and(
          eq(consentTemplates.id, template.id),
          eq(consentTemplates.studioId, context.studioId)
        )
      )
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "consent_template_archived",
      entityType: "consent_template",
      entityId: archived.id,
      before: { archivedAt: template.archivedAt },
      after: { archivedAt: archived.archivedAt?.toISOString() },
      reason: "command:consent_template_archived",
    });

    return archived;
  },

  /**
   * Creates a new draft version for a template.
   * Concurrency protection: Locks the logical template row with FOR UPDATE
   * so that concurrent requests for the same template allocate distinct sequential version numbers.
   */
  async createDraftVersion(
    tx: Transaction,
    context: TemplateContext,
    rawInput: CreateConsentTemplateDraftVersionInput
  ) {
    const input = createConsentTemplateDraftVersionSchema.parse(rawInput);

    // Row-lock the parent template to serialize version allocation for this template
    const [template] = await tx
      .select()
      .from(consentTemplates)
      .where(
        and(
          eq(consentTemplates.id, input.templateId),
          eq(consentTemplates.studioId, context.studioId)
        )
      )
      .for("update");

    if (!template) {
      throw new Error("Consent template not found");
    }

    if (template.archivedAt !== null) {
      throw new Error("Cannot create draft version for archived template");
    }

    const [versionAggregation] = await tx
      .select({
        maxVersion: sql<number>`coalesce(max(${consentTemplateVersions.versionNumber}), 0)`,
      })
      .from(consentTemplateVersions)
      .where(
        and(
          eq(consentTemplateVersions.templateId, template.id),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      );

    const nextVersionNumber = Number(versionAggregation?.maxVersion ?? 0) + 1;

    const normalizedTitle = input.title.trim();
    const normalizedBody = input.body.trim();
    const contentHash = computeCanonicalTemplateHash({
      title: normalizedTitle,
      body: normalizedBody,
    });

    const [version] = await tx
      .insert(consentTemplateVersions)
      .values({
        studioId: context.studioId,
        templateId: template.id,
        versionNumber: nextVersionNumber,
        title: normalizedTitle,
        body: normalizedBody,
        contentHash,
        createdById: context.userId,
        publishedAt: null,
      })
      .returning();

    return version;
  },

  /**
   * Updates an unpublished draft version's title and body.
   * Published versions are immutable and rejected before trigger.
   */
  async updateDraftVersion(
    tx: Transaction,
    context: TemplateContext,
    rawInput: UpdateConsentTemplateDraftVersionInput
  ) {
    const input = updateConsentTemplateDraftVersionSchema.parse(rawInput);

    const [version] = await tx
      .select()
      .from(consentTemplateVersions)
      .where(
        and(
          eq(consentTemplateVersions.id, input.versionId),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      )
      .for("update");

    if (!version) {
      throw new Error("Consent template version not found");
    }

    if (version.publishedAt !== null) {
      throw new Error("Published consent template versions cannot be edited");
    }

    const [template] = await tx
      .select()
      .from(consentTemplates)
      .where(
        and(
          eq(consentTemplates.id, version.templateId),
          eq(consentTemplates.studioId, context.studioId)
        )
      )
      .for("update");

    if (!template) {
      throw new Error("Consent template not found");
    }

    if (template.archivedAt !== null) {
      throw new Error("Cannot edit draft version of archived template");
    }

    const normalizedTitle = input.title.trim();
    const normalizedBody = input.body.trim();
    const contentHash = computeCanonicalTemplateHash({
      title: normalizedTitle,
      body: normalizedBody,
    });

    const [updated] = await tx
      .update(consentTemplateVersions)
      .set({
        title: normalizedTitle,
        body: normalizedBody,
        contentHash,
      })
      .where(
        and(
          eq(consentTemplateVersions.id, version.id),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      )
      .returning();

    return updated;
  },

  /**
   * Publishes a draft version, making it permanently immutable.
   */
  async publishVersion(
    tx: Transaction,
    context: TemplateContext,
    rawInput: PublishConsentTemplateVersionInput
  ) {
    const input = publishConsentTemplateVersionSchema.parse(rawInput);

    const [version] = await tx
      .select()
      .from(consentTemplateVersions)
      .where(
        and(
          eq(consentTemplateVersions.id, input.versionId),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      )
      .for("update");

    if (!version) {
      throw new Error("Consent template version not found");
    }

    // If already published, return existing (idempotency safety)
    if (version.publishedAt !== null) {
      return version;
    }

    const [template] = await tx
      .select()
      .from(consentTemplates)
      .where(
        and(
          eq(consentTemplates.id, version.templateId),
          eq(consentTemplates.studioId, context.studioId)
        )
      )
      .for("update");

    if (!template || template.studioId !== context.studioId) {
      throw new Error("Consent template not found");
    }

    if (template.archivedAt !== null) {
      throw new Error("Cannot publish draft version of archived template");
    }

    // Recompute canonical hash from persisted title/body
    const canonicalHash = computeCanonicalTemplateHash({
      title: version.title,
      body: version.body,
    });

    const publishedAt = new Date();
    const [published] = await tx
      .update(consentTemplateVersions)
      .set({
        publishedAt,
        contentHash: canonicalHash,
      })
      .where(
        and(
          eq(consentTemplateVersions.id, version.id),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      )
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "consent_template_version_published",
      entityType: "consent_template_version",
      entityId: published.id,
      before: {
        publishedAt: version.publishedAt,
        contentHash: version.contentHash,
      },
      after: {
        publishedAt: published.publishedAt?.toISOString(),
        contentHash: published.contentHash,
      },
      reason: "command:consent_template_version_published",
      metadata: {
        templateId: template.id,
        versionNumber: published.versionNumber,
      },
    });

    return published;
  },
};
