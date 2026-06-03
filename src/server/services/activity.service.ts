import { db } from "@/db";
import { activityEvents } from "@/db/schema";

export interface CreateActivityEventInput {
  studioId: string;
  clientId: string;
  userId?: string;
  type: string;
  title: string;
  description?: string;
  metadata?: any;
}

export const activityService = {
  async create(input: CreateActivityEventInput) {
    try {
      await db.insert(activityEvents).values({
        studioId: input.studioId,
        clientId: input.clientId,
        userId: input.userId,
        type: input.type as any,
        title: input.title,
        description: input.description,
        metadata: input.metadata || {},
      });
    } catch (error) {
      console.error("Failed to create activity event:", error);
    }
  }
};
