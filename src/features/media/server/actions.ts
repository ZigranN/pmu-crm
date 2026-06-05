"use server";

import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { db } from "@/db";
import { mediaService } from "./service";
import { revalidatePath } from "next/cache";

export async function uploadMediaAction(formData: FormData) {
  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");

    const studioId = await getCurrentStudioId(session.user.id);
    if (!studioId) throw new Error("Studio not found");

    const canCreate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MEDIA_CREATE);
    if (!canCreate) throw new Error("Permission denied");

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

    const canCreate = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MEDIA_CREATE);
    if (!canCreate) throw new Error("Permission denied");

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

export async function getClientMediaAction(clientId: string) {
  try {
    const session = await getSession();
    if (!session) throw new Error("Unauthorized");

    const studioId = await getCurrentStudioId(session.user.id);
    if (!studioId) throw new Error("Studio not found");

    const canRead = await hasPermission(db, session.user.id, studioId, PERMISSIONS.MEDIA_READ);
    if (!canRead) throw new Error("Permission denied");

    return await mediaService.getClientMedia(clientId, studioId);
  } catch (error) {
    console.error("[getClientMediaAction error]", error);
    throw error;
  }
}
