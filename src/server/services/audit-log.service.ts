import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export interface CreateAuditLogInput {
  studioId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: any;
}

export const auditLogService = {
  async create(input: CreateAuditLogInput) {
    try {
      await db.insert(auditLogs).values({
        studioId: input.studioId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata || {},
      });
    } catch (error) {
      console.error("Failed to create audit log:", error);
      // Мы не бросаем ошибку здесь, чтобы не прерывать основное действие
    }
  }
};
