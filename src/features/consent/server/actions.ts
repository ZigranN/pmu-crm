"use server";

import { requireBrowserStudioPermission } from "@/server/auth/context";
import { getClientById } from "@/features/clients/server/queries";
import { PERMISSIONS } from "@/lib/permissions";
import { consentService } from "./service";
import { templateService } from "./template-service";
import {
  getConsentTemplateById,
  getConsentTemplateVersionById,
  listConsentTemplates,
  listConsentTemplateVersions,
} from "./template-queries";
import {
  createConsentTemplateDraftVersionSchema,
  createConsentTemplateSchema,
  publishConsentTemplateVersionSchema,
  updateConsentTemplateDraftVersionSchema,
  archiveConsentTemplateSchema,
  type CreateConsentTemplateDraftVersionInput,
  type CreateConsentTemplateInput,
  type UpdateConsentTemplateDraftVersionInput,
} from "../schemas/template.schema";
import { db } from "@/db";
import { cycleConsents } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
import { revalidatePath } from "next/cache";
import { consentSigningService } from "./signing";
import { resolveEffectiveConsent } from "./coverage";
import {
  createCycleConsentDraftSchema,
  signCycleConsentSchema,
  type CreateCycleConsentDraftInput,
  type SignCycleConsentInput,
} from "../schemas/signing.schema";

// Legacy consent actions
export async function uploadConsentAction(formData: FormData) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_UPLOAD);

  const file = formData.get("file") as File;
  const clientId = formData.get("clientId") as string;
  const procedureSessionId = formData.get("procedureSessionId") as string | undefined;
  const consentTypeStr = (formData.get("consentType") as string) || "pmu_general";
  const signedAtStr = formData.get("signedAt") as string;
  const notes = formData.get("notes") as string | undefined;

  if (!file) throw new Error("File is required");
  if (!clientId) throw new Error("Client ID is required");

  const signedAt = signedAtStr ? new Date(signedAtStr) : new Date();
  const consentType = consentTypeStr as
    | "pmu_general"
    | "brows"
    | "lips"
    | "eyes"
    | "facial"
    | "remover"
    | "photo_permission"
    | "marketing_permission"
    | "other";

  const consent = await consentService.uploadConsent(file, {
    studioId: context.studioId,
    clientId,
    procedureSessionId: procedureSessionId || undefined,
    consentType,
    signedAt,
    notes,
    createdById: context.userId,
  });

  revalidatePath(`/clients/${clientId}`);
  return consent;
}

export async function getClientConsentsAction(clientId: string) {
  try {
    const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_READ);
    if (!(await getClientById(clientId, context.studioId))) return [];
    return await consentService.getClientConsents(clientId, context.studioId);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "FORBIDDEN_PERMISSION" ||
        error.name === "ForbiddenPermissionError" ||
        error.message === "STUDIO_ACCESS_DENIED" ||
        error.name === "StudioAccessDeniedError" ||
        error.message === "STUDIO_CONTEXT_REQUIRED" ||
        error.name === "StudioContextRequiredError" ||
        error.message === "STUDIO_CONTEXT_STALE" ||
        error.name === "StudioContextStaleError")
    ) {
      throw new Error("Permission denied");
    }
    throw error;
  }
}

export async function deleteConsentAction(consentId: string, clientId: string) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_UPLOAD);
  await consentService.deleteConsent(consentId, context.studioId, context.userId, clientId);
  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}

// ── Phase 3.2C Consent Template Actions ─────────────────────────

export async function createConsentTemplateAction(
  input: CreateConsentTemplateInput,
  requestKey?: string
) {
  const context = await requireBrowserStudioPermission("SETTINGS_UPDATE");
  const validated = createConsentTemplateSchema.parse(input);

  if (requestKey) {
    return idempotentCommand<{ id: string; code: string; name: string }>(
      context,
      "SETTINGS_UPDATE",
      "consent_template.create.v1",
      requestKey,
      validated as unknown as Json,
      async (tx) => {
        const created = await templateService.createTemplate(tx, context, validated);
        return { id: created.id, code: created.code, name: created.name };
      },
      async (tx, result) => {
        const found = await getConsentTemplateById(context.studioId, result.id, tx);
        if (!found) throw new Error("Consent template not found");
      }
    );
  }

  return db.transaction(async (tx) => {
    return templateService.createTemplate(tx, context, validated);
  });
}

export async function archiveConsentTemplateAction(templateId: string) {
  const context = await requireBrowserStudioPermission("SETTINGS_UPDATE");
  archiveConsentTemplateSchema.parse({ templateId });

  return db.transaction(async (tx) => {
    return templateService.archiveTemplate(tx, context, { templateId });
  });
}

export async function createConsentTemplateDraftVersionAction(
  input: CreateConsentTemplateDraftVersionInput,
  requestKey?: string
) {
  const context = await requireBrowserStudioPermission("SETTINGS_UPDATE");
  const validated = createConsentTemplateDraftVersionSchema.parse(input);

  if (requestKey) {
    return idempotentCommand<{
      id: string;
      templateId: string;
      versionNumber: number;
      contentHash: string;
    }>(
      context,
      "SETTINGS_UPDATE",
      "consent_template_version.create.v1",
      requestKey,
      validated as unknown as Json,
      async (tx) => {
        const version = await templateService.createDraftVersion(tx, context, validated);
        return {
          id: version.id,
          templateId: version.templateId,
          versionNumber: version.versionNumber,
          contentHash: version.contentHash,
        };
      },
      async (tx, result) => {
        const found = await getConsentTemplateVersionById(context.studioId, result.id, tx);
        if (!found) throw new Error("Consent template version not found");
      }
    );
  }

  return db.transaction(async (tx) => {
    return templateService.createDraftVersion(tx, context, validated);
  });
}

export async function updateConsentTemplateDraftVersionAction(
  input: UpdateConsentTemplateDraftVersionInput
) {
  const context = await requireBrowserStudioPermission("SETTINGS_UPDATE");
  const validated = updateConsentTemplateDraftVersionSchema.parse(input);

  return db.transaction(async (tx) => {
    return templateService.updateDraftVersion(tx, context, validated);
  });
}

export async function publishConsentTemplateVersionAction(
  versionId: string,
  requestKey?: string
) {
  const context = await requireBrowserStudioPermission("SETTINGS_UPDATE");
  publishConsentTemplateVersionSchema.parse({ versionId });

  if (requestKey) {
    return idempotentCommand<{
      id: string;
      templateId: string;
      versionNumber: number;
      publishedAt: string;
      contentHash: string;
    }>(
      context,
      "SETTINGS_UPDATE",
      "consent_template_version.publish.v1",
      requestKey,
      { versionId } as unknown as Json,
      async (tx) => {
        const published = await templateService.publishVersion(tx, context, { versionId });
        return {
          id: published.id,
          templateId: published.templateId,
          versionNumber: published.versionNumber,
          publishedAt: published.publishedAt!.toISOString(),
          contentHash: published.contentHash,
        };
      },
      async (tx, result) => {
        const found = await getConsentTemplateVersionById(context.studioId, result.id, tx);
        if (!found) throw new Error("Consent template version not found");
        if (!found.publishedAt) throw new Error("Consent template version not published");
      }
    );
  }

  return db.transaction(async (tx) => {
    return templateService.publishVersion(tx, context, { versionId });
  });
}

export async function getConsentTemplateAction(templateId: string) {
  const context = await requireBrowserStudioPermission("CONSENT_READ");
  return getConsentTemplateById(context.studioId, templateId);
}

export async function listConsentTemplatesAction(options?: { includeArchived?: boolean }) {
  const context = await requireBrowserStudioPermission("CONSENT_READ");
  return listConsentTemplates(context.studioId, options);
}

export async function listConsentTemplateVersionsAction(templateId: string) {
  const context = await requireBrowserStudioPermission("CONSENT_READ");
  return listConsentTemplateVersions(context.studioId, templateId);
}

// ── Phase 3.2 Final Cycle Consent Actions ───────────────────────

export async function createCycleConsentDraftAction(
  input: CreateCycleConsentDraftInput
) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_UPLOAD);
  const validated = createCycleConsentDraftSchema.parse(input);

  return db.transaction(async (tx) => {
    return consentSigningService.createDraft(tx, context, validated);
  });
}

export async function signCycleConsentAction(
  input: SignCycleConsentInput,
  requestKey?: string
) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_UPLOAD);
  const validated = signCycleConsentSchema.parse(input);

  return consentSigningService.signConsent(context, validated, requestKey);
}

export async function resolveEffectiveConsentAction(cycleId: string) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_READ);
  return resolveEffectiveConsent(context, cycleId);
}

export async function getCycleConsentByIdAction(consentId: string) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.CONSENT_READ);
  const [consent] = await db
    .select()
    .from(cycleConsents)
    .where(
      and(
        eq(cycleConsents.id, consentId),
        eq(cycleConsents.studioId, context.studioId)
      )
    )
    .limit(1);

  return consent ?? null;
}
