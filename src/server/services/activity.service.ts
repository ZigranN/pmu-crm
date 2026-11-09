import "server-only";
import { activityEvents, activityEventTypeEnum } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { z } from "zod";
import { snapshot } from "./audit-log.service";
const contract = z.object({ studioId: z.string().uuid(), clientId: z.string().uuid(), userId: z.string().min(1),
  type: z.enum(activityEventTypeEnum.enumValues), title: z.string().min(1), description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export interface ActivityInput {
  studioId: string; clientId: string; userId: string;
  type: typeof activityEventTypeEnum.enumValues[number];
  title: string; description?: string; metadata?: Record<string, unknown>;
}
export async function writeActivity(tx: Transaction, input: ActivityInput) {
  const { studioId, clientId, userId, type, title, description, metadata } = input;
  const data = contract.parse({
    studioId,
    clientId,
    userId,
    type,
    title,
    ...(description !== undefined ? { description } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  });
  await tx.insert(activityEvents).values({ ...data, metadata: data.metadata ? snapshot(data.metadata) : {} });
}
