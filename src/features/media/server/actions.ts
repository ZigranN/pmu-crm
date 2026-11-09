"use server";

import { requireBrowserStudioPermission } from "@/server/auth/context";
import { getClientById } from "@/features/clients/server/queries";
import { mediaService } from "./service";
import { revalidatePath } from "next/cache";

export async function uploadMediaAction(formData: FormData) {
  try {
    const context = await requireBrowserStudioPermission("MEDIA_CREATE");

    const file = formData.get("file") as File;
    const clientId = formData.get("clientId") as string;
    const type = formData.get("type") as any || "other";
    const caption = formData.get("caption") as string | undefined;
    const appointmentId = formData.get("appointmentId") as string | undefined;
    const procedureSessionId = formData.get("procedureSessionId") as string | undefined;

    if (!file) throw new Error("File is required");
    if (!clientId) throw new Error("Client ID is required");

    const newMedia = await mediaService.uploadMedia(file, {
      studioId: context.studioId,
      clientId,
      appointmentId: appointmentId || undefined,
      procedureSessionId: procedureSessionId || undefined,
      type,
      caption,
      createdById: context.userId,
    });

    revalidatePath(`/clients/${clientId}`);

    return {
      ...newMedia,
      url: `/api/media/${newMedia.id}/content`,
    };
  } catch (error) {
    console.error("[uploadMediaAction error]", error);
    throw error;
  }
}

export async function deleteMediaAction(mediaId: string) {
  try {
    const context = await requireBrowserStudioPermission("MEDIA_CREATE");

    const mediaRecord = await mediaService.getMediaById(mediaId, context.studioId, "archive");
    if (!mediaRecord) throw new Error("Media not found");

    await mediaService.deleteMedia(mediaId, context.studioId, context.userId);

    if (mediaRecord.clientId) {
      revalidatePath(`/clients/${mediaRecord.clientId}`);
    }

    return { success: true };
  } catch (error) {
    console.error("[deleteMediaAction error]", error);
    throw error;
  }
}

export async function getClientMediaAction(clientId: string, kind: "media" | "consent" = "media") {
  if (kind !== "media" && kind !== "consent") throw new Error("Invalid media kind");
  try {
    const context = await requireBrowserStudioPermission(kind === "consent" ? "CONSENT_READ" : "MEDIA_READ");
    if (!await getClientById(clientId, context.studioId)) return [];
    return mediaService.getClientMedia(clientId, context.studioId, kind);
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
