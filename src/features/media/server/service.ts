import "server-only";
import { db } from "@/db";
import { media, auditLogs, consents, activityEvents, mediaTypeEnum } from "@/db/schema";
import { eq, and, isNull, ne } from "drizzle-orm";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
import { requireStudioPermission } from "@/server/auth/context";
import { validateMediaLinks, lockClient, entityId, type Transaction } from "@/server/commands/ownership";
import { z } from "zod";

export interface CreateMediaInput {
  studioId: string;
  clientId: string;
  appointmentId?: string;
  procedureSessionId?: string;
  type: typeof mediaTypeEnum.enumValues[number];
  caption?: string;
  createdById: string;
}

// Shared upload boundary: authorization before provider I/O, revalidation after
// I/O, and one DB transaction for media plus the caller's associated records.
export async function withMediaUpload<T>(file: File, input: CreateMediaInput,
  persist: (tx: Transaction, record: typeof media.$inferSelect) => Promise<T>): Promise<T> {
  const type = z.enum(mediaTypeEnum.enumValues).parse(input.type);
  const context = await requireStudioPermission(type === "consent" ? "CONSENT_UPLOAD" : "MEDIA_CREATE", input.studioId);
  if (context.userId !== input.createdById) throw new Error("Permission denied");
  if (!(file instanceof File) || !file.size) throw new Error("File is required");
  await db.transaction((tx) => validateMediaLinks(tx, input));
  const { url, publicId } = await uploadToCloudinary(file, { folder: `crm-pmu/${input.studioId}/${type}` });
  try {
    return await db.transaction(async (tx) => {
      await validateMediaLinks(tx, input);
      const [record] = await tx.insert(media).values({ ...input, type, url, publicId: publicId || null }).returning();
      await tx.insert(auditLogs).values({ studioId: input.studioId, userId: context.userId, action: "media_uploaded",
        entityType: "media", entityId: record.id, metadata: { type, clientId: input.clientId } });
      return persist(tx, record);
    });
  } catch (error) {
    if (publicId) {
      try { await deleteFromCloudinary(publicId); }
      catch { console.error("Media upload rollback: provider cleanup failed", { publicId }); }
    }
    throw error;
  }
}

export const mediaService = {
  async uploadMedia(file: File, input: CreateMediaInput) {
    return withMediaUpload(file, input, async (_tx, record) => record);
  },

  // Archive retains the original file and linked consent. Legal document
  // versioning will be added separately; this operation never destroys evidence.
  async deleteMedia(mediaId: string, studioId: string, userId: string, expectedClientId?: string) {
    entityId.parse(mediaId);
    const record = await this.getMediaById(mediaId, studioId);
    if (!record || (expectedClientId && record.clientId !== expectedClientId)) throw new Error("Media not found");
    const context = await requireStudioPermission(record.type === "consent" ? "CONSENT_UPLOAD" : "MEDIA_CREATE", studioId);
    if (context.userId !== userId) throw new Error("Permission denied");
    await db.transaction(async (tx) => {
      await lockClient(tx, record.clientId, studioId);
      const [archived] = await tx.update(media).set({ deletedAt: new Date(), deletedById: userId })
        .where(and(eq(media.id, mediaId), eq(media.studioId, studioId), eq(media.clientId, record.clientId), isNull(media.deletedAt))).returning();
      if (!archived) throw new Error("Media not found");
      await tx.insert(auditLogs).values({ studioId, userId, action: "media_archived", entityType: "media", entityId: mediaId,
        metadata: { type: record.type, clientId: record.clientId } });
      if (record.type === "consent") {
        const documents = await tx.select().from(consents).where(and(eq(consents.mediaId, mediaId), eq(consents.studioId, studioId), eq(consents.clientId, record.clientId)));
        for (const document of documents) {
          await tx.insert(auditLogs).values({ studioId, userId, action: "consent_archived", entityType: "consent", entityId: document.id });
        }
        await tx.insert(activityEvents).values({ studioId, clientId: record.clientId, userId, type: "consent_archived",
          title: "Согласие архивировано", description: "Исходный файл и история сохранены" });
      }
    });
  },

  async getClientMedia(clientId: string, studioId: string, kind: "media" | "consent" = "media") {
    return db.query.media.findMany({
      where: and(eq(media.clientId, clientId), eq(media.studioId, studioId), isNull(media.deletedAt),
        kind === "consent" ? eq(media.type, "consent") : ne(media.type, "consent")),
      orderBy: (media, { desc }) => [desc(media.createdAt)],
    });
  },

  async getMediaById(mediaId: string, studioId: string) {
    return db.query.media.findFirst({ where: and(eq(media.id, mediaId), eq(media.studioId, studioId), isNull(media.deletedAt)) });
  },
};
