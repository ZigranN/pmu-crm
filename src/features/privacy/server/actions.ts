"use server";

import { db } from "@/db";
import {
  privacyRequests,
  clients,
  studioPrivacyRetentionPolicies,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  requireBrowserStudioPermission,
} from "@/server/auth/context";
import { lockStudioAccess } from "@/server/auth/scopes";
import { writeAudit } from "@/server/services/audit-log.service";
import { revalidatePath } from "next/cache";
import {
  CreatePrivacyRequestSchema,
  ApprovePrivacyRequestSchema,
  CancelPrivacyRequestSchema,
  AnonymizeClientSchema,
  UpdateRetentionPolicySchema,
  type CreatePrivacyRequestInput,
  type ApprovePrivacyRequestInput,
  type CancelPrivacyRequestInput,
  type AnonymizeClientInput,
  type UpdateRetentionPolicyInput,
} from "../schemas/privacy.schema";
import { executePrivacyExport } from "./export-service";
import { anonymizeClient, executePrivacyAnonymize } from "./anonymization-service";
import { executeRetentionCleanup } from "./retention-service";

export async function createPrivacyRequestAction(input: CreatePrivacyRequestInput) {
  const data = CreatePrivacyRequestSchema.parse(input);
  const context = await requireBrowserStudioPermission(
    data.requestType === "EXPORT" ? "PRIVACY_EXPORT" : "PRIVACY_MANAGE"
  );

  const [clientRow] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, data.clientId), eq(clients.studioId, context.studioId)))
    .limit(1);

  if (!clientRow) {
    throw new Error("Client not found in studio");
  }

  const [req] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(privacyRequests)
      .values({
        studioId: context.studioId,
        clientId: data.clientId,
        requestType: data.requestType,
        status: "REQUESTED",
        requestedById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "privacy_request_created",
      entityType: "privacy_request",
      entityId: inserted.id,
      before: null,
      after: {
        clientId: data.clientId,
        requestType: data.requestType,
        status: "REQUESTED",
      },
      reason: data.reason || "user:privacy_request_created",
      reasonSource: "user",
      metadata: { clientId: data.clientId },
    });

    return [inserted];
  });

  revalidatePath("/settings/privacy");
  revalidatePath(`/clients/${data.clientId}`);
  return { success: true, requestId: req.id };
}

export async function approvePrivacyRequestAction(input: ApprovePrivacyRequestInput) {
  const data = ApprovePrivacyRequestSchema.parse(input);
  const context = await requireBrowserStudioPermission("PRIVACY_MANAGE");

  let reqType: string;
  let targetClientId: string;

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER", "ADMIN"].includes(actor.role)) {
      throw new Error("Only studio owners and administrators can approve privacy requests");
    }

    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.id, data.requestId), eq(privacyRequests.studioId, context.studioId)))
      .for("update")
      .limit(1);

    if (!request) {
      throw new Error("Privacy request not found");
    }

    if (request.status !== "REQUESTED") {
      throw new Error(`Cannot approve request in status ${request.status}`);
    }

    reqType = request.requestType;
    targetClientId = request.clientId;

    await tx
      .update(privacyRequests)
      .set({
        status: "APPROVED",
        approvedById: context.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(privacyRequests.id, data.requestId));

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "privacy_request_approved",
      entityType: "privacy_request",
      entityId: data.requestId,
      before: { status: "REQUESTED" },
      after: { status: "APPROVED", approvedById: context.userId },
      reason: "user:privacy_request_approved",
      reasonSource: "user",
      metadata: { clientId: request.clientId },
    });
  });

  // Execute immediately if approved
  if (reqType! === "EXPORT") {
    await executePrivacyExport(data.requestId, context.studioId, context.userId);
  } else if (reqType! === "ANONYMIZE" || reqType! === "DELETE_WHERE_ALLOWED") {
    await executePrivacyAnonymize(data.requestId, context.studioId, context.userId, "Approved DSAR Request");
  }

  revalidatePath("/settings/privacy");
  if (targetClientId!) {
    revalidatePath(`/clients/${targetClientId}`);
  }
  return { success: true };
}

export async function cancelPrivacyRequestAction(input: CancelPrivacyRequestInput) {
  const data = CancelPrivacyRequestSchema.parse(input);
  const context = await requireBrowserStudioPermission("PRIVACY_MANAGE");

  let targetClientId: string | undefined;

  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.id, data.requestId), eq(privacyRequests.studioId, context.studioId)))
      .for("update")
      .limit(1);

    if (!request) {
      throw new Error("Privacy request not found");
    }

    if (request.status === "COMPLETED") {
      throw new Error("Cannot cancel a completed privacy request");
    }

    targetClientId = request.clientId;

    await tx
      .update(privacyRequests)
      .set({
        status: "CANCELLED",
        failedAt: new Date(),
        failureReason: data.reason || "Cancelled by operator",
        updatedAt: new Date(),
      })
      .where(eq(privacyRequests.id, data.requestId));

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "privacy_request_cancelled",
      entityType: "privacy_request",
      entityId: data.requestId,
      before: { status: request.status },
      after: { status: "CANCELLED" },
      reason: data.reason || "user:privacy_request_cancelled",
      reasonSource: "user",
      metadata: { clientId: request.clientId },
    });
  });

  revalidatePath("/settings/privacy");
  if (targetClientId) {
    revalidatePath(`/clients/${targetClientId}`);
  }
  return { success: true };
}

export async function executePrivacyExportAction(requestId: string) {
  const context = await requireBrowserStudioPermission("PRIVACY_EXPORT");
  const result = await executePrivacyExport(requestId, context.studioId, context.userId);
  revalidatePath("/settings/privacy");
  return { success: true, artifactId: result.exportArtifactId };
}

export async function anonymizeClientAction(input: AnonymizeClientInput) {
  const data = AnonymizeClientSchema.parse(input);
  const context = await requireBrowserStudioPermission("PRIVACY_MANAGE");

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER"].includes(actor.role)) {
      throw new Error("Only studio owners can perform irreversible client anonymization");
    }

    const [clientRow] = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, data.clientId), eq(clients.studioId, context.studioId)))
      .for("update")
      .limit(1);

    if (!clientRow) {
      throw new Error("Client not found in studio");
    }

    // High friction confirmation: client name must match
    const expectedName = (clientRow.fullName || clientRow.firstName || "").trim().toLowerCase();
    const providedName = data.confirmClientName.trim().toLowerCase();
    if (expectedName !== providedName) {
      throw new Error("Confirmation name does not match client record");
    }

    await anonymizeClient(context.studioId, data.clientId, context.userId, data.reason, tx);
  });

  revalidatePath(`/clients/${data.clientId}`);
  revalidatePath("/clients");
  revalidatePath("/settings/privacy");
  return { success: true };
}

export async function updateStudioRetentionPolicyAction(input: UpdateRetentionPolicyInput) {
  const data = UpdateRetentionPolicySchema.parse(input);
  const context = await requireBrowserStudioPermission("PRIVACY_MANAGE");

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER"].includes(actor.role)) {
      throw new Error("Only studio owners can configure data retention policies");
    }

    await tx
      .insert(studioPrivacyRetentionPolicies)
      .values({
        studioId: context.studioId,
        temporaryUploadRetentionDays: data.temporaryUploadRetentionDays,
        privacyExportRetentionDays: data.privacyExportRetentionDays,
        orphanMediaGraceDays: data.orphanMediaGraceDays,
      })
      .onConflictDoUpdate({
        target: studioPrivacyRetentionPolicies.studioId,
        set: {
          temporaryUploadRetentionDays: data.temporaryUploadRetentionDays,
          privacyExportRetentionDays: data.privacyExportRetentionDays,
          orphanMediaGraceDays: data.orphanMediaGraceDays,
          updatedAt: new Date(),
        },
      });

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "studio_settings_updated",
      entityType: "studio",
      entityId: context.studioId,
      before: null,
      after: data,
      reason: "user:update_retention_policy",
      reasonSource: "user",
    });
  });

  revalidatePath("/settings/privacy");
  return { success: true };
}

export async function triggerRetentionCleanupAction() {
  const context = await requireBrowserStudioPermission("PRIVACY_MANAGE");
  const result = await executeRetentionCleanup(context.studioId, context.userId);
  revalidatePath("/settings/privacy");
  return { success: true, result };
}
