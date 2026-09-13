import "server-only";
import { activityEvents, activityEventTypeEnum } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";
import { z } from "zod";
import { snapshot } from "./audit-log.service";
const contract = z.object({ studioId: z.string().uuid(), clientId: z.string().uuid(), userId: z.string().min(1),
  type: z.enum(activityEventTypeEnum.enumValues), title: z.string().min(1), description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type ActivityInput = z.infer<typeof contract>;
export async function writeActivity(tx: Transaction, input: ActivityInput) {
  const data = contract.parse(input);
  await tx.insert(activityEvents).values({ ...data, metadata: data.metadata ? snapshot(data.metadata) : {} });
}
