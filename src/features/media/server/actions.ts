"use server";

import { requireStudioPermission } from "@/server/auth/context";
import { getClientById } from "@/features/clients/server/queries";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { mediaService } from "./service";
import { revalidatePath } from "next/cache";

export async function uploadMediaAction(formData: FormData) {
  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");

    const studioId = await getCurrentStudioId(session.user.id);
    if (!studioId) throw new Error("Studio not found");

    const file = formData.get("file") as File;
    const clientId = formData.get("clientId") as string;
    const type = formData.get("type") as any || "other";
    const caption = formData.get("caption") as string | undefined;

    if (!file) throw new Error("File is required");
    if (!clientId) throw new Error("Client ID is required");

    const newMedia = await mediaService.uploadMedia(file, {
      studioId,
      clientId,
      type,
      caption,
      createdById: session.user.id,
    });

    revalidatePath(`/clients/${clientId}`);

    return newMedia;
  } catch (error) {
    console.error("[uploadMediaAction error]", error);
    throw error;
  }
}

export async function deleteMediaAction(mediaId: string) {
  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");

    const studioId = await getCurrentStudioId(session.user.id);
    if (!studioId) throw new Error("Studio not found");

    const mediaRecord = await mediaService.getMediaById(mediaId, studioId);
    if (!mediaRecord) throw new Error("Media not found");

    await mediaService.deleteMedia(mediaId, studioId, session.user.id);

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
  const { studioId } = await requireStudioPermission(kind === "consent" ? "CONSENT_READ" : "MEDIA_READ");
  if (!await getClientById(clientId, studioId)) return [];
  return mediaService.getClientMedia(clientId, studioId, kind);
}
