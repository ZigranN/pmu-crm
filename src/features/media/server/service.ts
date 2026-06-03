"use server";

import { db } from "@/db";
import { media } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
import { auditLogService } from "@/server/services/audit-log.service";

export interface CreateMediaInput {
  studioId: string;
  clientId: string;
  appointmentId?: string;
  procedureSessionId?: string;
  type: "before" | "after" | "healing_day_7" | "healing_day_30" | "correction" | "refresh" | "consent" | "document" | "portfolio" | "other";
  caption?: string;
  createdById: string;
}

export const mediaService = {
  async uploadMedia(file: File, input: CreateMediaInput) {
    // Upload to Cloudinary
    const { url, publicId } = await uploadToCloudinary(file, {
      folder: `crm-pmu/${input.studioId}/${input.type}`,
    });

    // Save to database
    const [newMedia] = await db.insert(media).values({
      type: input.type as any,
      studioId: input.studioId,
      clientId: input.clientId,
      appointmentId: input.appointmentId || null,
      procedureSessionId: input.procedureSessionId || null,
      url,
      publicId: publicId || null,
      caption: input.caption || null,
      createdById: input.createdById,
    }).returning();

    // Create audit log
    await auditLogService.create({
      studioId: input.studioId,
      userId: input.createdById,
      action: "media_uploaded",
      entityType: "media",
      entityId: newMedia.id,
      metadata: {
        type: input.type,
        clientId: input.clientId,
      },
    });

    return newMedia;
  },

  async deleteMedia(mediaId: string, studioId: string, userId: string) {
    const mediaRecord = await db.query.media.findFirst({
      where: and(eq(media.id, mediaId), eq(media.studioId, studioId)),
    });

    if (!mediaRecord) {
      throw new Error("Media not found");
    }

    // Delete from Cloudinary
    if (mediaRecord.publicId) {
      await deleteFromCloudinary(mediaRecord.publicId);
    }

    // Soft delete from database
    await db.update(media)
      .set({ deletedAt: new Date() })
      .where(eq(media.id, mediaId));

    // Create audit log
    await auditLogService.create({
      studioId,
      userId,
      action: "media_deleted",
      entityType: "media",
      entityId: mediaId,
      metadata: {
        type: mediaRecord.type,
        clientId: mediaRecord.clientId,
      },
    });
  },

  async getClientMedia(clientId: string, studioId: string) {
    return await db.query.media.findMany({
      where: and(
        eq(media.clientId, clientId),
        eq(media.studioId, studioId),
        isNull(media.deletedAt)
      ),
      orderBy: (media, { desc }) => [desc(media.createdAt)],
    });
  },

  async getMediaById(mediaId: string, studioId: string) {
    return await db.query.media.findFirst({
      where: and(
        eq(media.id, mediaId),
        eq(media.studioId, studioId),
        isNull(media.deletedAt)
      ),
    });
  },
};
