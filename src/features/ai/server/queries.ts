import { db } from "@/db";
import { aiRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { PERMISSIONS } from "@/lib/permissions";
import type { ClientSummaryOutput, ConversationSummaryOutput } from "../schemas/ai.schema";
import { getStudioAiUsageSummary } from "./service";

export async function getLatestClientAiSummary(clientId: string): Promise<{
  run: any | null;
  summary: ClientSummaryOutput | null;
}> {
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_READ);

  const run = await db.query.aiRuns.findFirst({
    where: and(
      eq(aiRuns.studioId, context.studioId),
      eq(aiRuns.feature, "client_summary"),
      eq(aiRuns.entityId, clientId),
      eq(aiRuns.status, "completed")
    ),
    orderBy: [desc(aiRuns.createdAt)],
  });

  return {
    run: run || null,
    summary: (run?.result as ClientSummaryOutput) || null,
  };
}

export async function getLatestConversationAiSummary(conversationId: string): Promise<{
  run: any | null;
  summary: ConversationSummaryOutput | null;
}> {
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_READ);

  const run = await db.query.aiRuns.findFirst({
    where: and(
      eq(aiRuns.studioId, context.studioId),
      eq(aiRuns.feature, "conversation_summary"),
      eq(aiRuns.entityId, conversationId),
      eq(aiRuns.status, "completed")
    ),
    orderBy: [desc(aiRuns.createdAt)],
  });

  return {
    run: run || null,
    summary: (run?.result as ConversationSummaryOutput) || null,
  };
}

export async function getStudioAiUsageAction() {
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_READ);
  return getStudioAiUsageSummary(db, context.studioId);
}

export async function listAiRuns(
  options: {
    entityType?: string;
    entityId?: string;
    limit?: number;
  } = {}
) {
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_READ);

  return db.query.aiRuns.findMany({
    where: and(
      eq(aiRuns.studioId, context.studioId),
      options.entityType ? eq(aiRuns.entityType, options.entityType) : undefined,
      options.entityId ? eq(aiRuns.entityId, options.entityId) : undefined
    ),
    orderBy: [desc(aiRuns.createdAt)],
    limit: options.limit || 20,
  });
}
