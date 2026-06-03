"use server";

import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { db } from "@/db";
import { consentService } from "./service";
import { revalidatePath } from "next/cache";

export async function uploadConsentAction(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpload = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CONSENT_UPLOAD);
  if (!canUpload) throw new Error("Permission denied");

  const file = formData.get("file") as File;
  const clientId = formData.get("clientId") as string;
  const consentTypeStr = formData.get("consentType") as string || "pmu_general";
  const signedAtStr = formData.get("signedAt") as string;
  const notes = formData.get("notes") as string | undefined;

  if (!file) throw new Error("File is required");
  if (!clientId) throw new Error("Client ID is required");

  const signedAt = signedAtStr ? new Date(signedAtStr) : new Date();
  const consentType = consentTypeStr as "pmu_general" | "brows" | "lips" | "eyes" | "facial" | "remover" | "photo_permission" | "marketing_permission" | "other";

  const consent = await consentService.uploadConsent(file, {
    studioId,
    clientId,
    consentType,
    signedAt,
    notes,
    createdById: session.user.id,
  });

  revalidatePath(`/clients/${clientId}`);
  return consent;
}

export async function getClientConsentsAction(clientId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canRead = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CONSENT_READ);
  if (!canRead) throw new Error("Permission denied");

  return await consentService.getClientConsents(clientId, studioId);
}

export async function deleteConsentAction(consentId: string, clientId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) throw new Error("Studio not found");

  const canUpload = await hasPermission(db, session.user.id, studioId, PERMISSIONS.CONSENT_UPLOAD);
  if (!canUpload) throw new Error("Permission denied");

  await consentService.deleteConsent(consentId, studioId, session.user.id);

  revalidatePath(`/clients/${clientId}`);
  return { success: true };
}
