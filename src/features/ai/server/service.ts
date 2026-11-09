import { aiRuns } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getAiProvider } from "../providers";
import {
  ClientSummaryOutputSchema,
  ConversationSummaryOutputSchema,
  ReplyDraftOutputSchema,
  NextActionSuggestionsOutputSchema,
  NeedsAttentionExplainOutputSchema,
  type ClientSummaryOutput,
  type ConversationSummaryOutput,
  type ReplyDraftOutput,
  type NextActionSuggestionsOutput,
  type NeedsAttentionExplainOutput,
} from "../schemas/ai.schema";
import {
  buildClientSummaryPrompt,
  buildConversationSummaryPrompt,
  buildReplyDraftPrompt,
  buildNextActionPrompt,
  buildNeedsAttentionPrompt,
  type NeedsAttentionPromptInput,
} from "../prompts";
import {
  assembleClientSummaryContext,
  assembleConversationContext,
  assembleReplyDraftContext,
  assembleNextActionContext,
} from "../domain/context-assembler";
import {
  guardSuggestedActions,
  sanitizeReplyDraft,
} from "../domain/guardrails";
import { globalAiRateLimiter, withBoundedRetry } from "./rate-limiter";
import { AiRateLimitError } from "../providers/types";

export interface StudioUserContext {
  studioId: string;
  userId: string;
}

export async function generateClientSummary(
  executor: any,
  context: StudioUserContext,
  clientId: string,
  requestKey?: string
): Promise<ClientSummaryOutput> {
  const rateLimitKey = `${context.studioId}:${context.userId}`;
  const rateCheck = globalAiRateLimiter.checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    throw new AiRateLimitError(
      `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetInMs / 1000)} seconds before requesting another summary.`
    );
  }

  // Idempotency check: if requestKey exists and already completed in this studio, return saved result
  if (requestKey) {
    const existing = await executor.query.aiRuns.findFirst({
      where: and(
        eq(aiRuns.studioId, context.studioId),
        eq(aiRuns.requestKey, requestKey)
      ),
    });
    if (existing && existing.status === "completed" && existing.result) {
      return existing.result as ClientSummaryOutput;
    }
  }

  const promptInput = await assembleClientSummaryContext(
    executor,
    context.studioId,
    clientId
  );

  const { systemPrompt, prompt, promptVersion } = buildClientSummaryPrompt(promptInput);
  const provider = getAiProvider();

  // Create or record started AI run
  let runId: string | undefined;
  try {
    const [inserted] = await executor
      .insert(aiRuns)
      .values({
        studioId: context.studioId,
        userId: context.userId,
        feature: "client_summary",
        entityType: "client",
        entityId: clientId,
        status: "started",
        provider: provider.name,
        model: "copilot-v1",
        promptVersion,
        requestKey: requestKey || null,
      })
      .returning({ id: aiRuns.id });
    runId = inserted?.id;
  } catch (err: any) {
    // If requestKey conflict happened on insert (duplicate in same studio), read existing
    if (requestKey && String(err).includes("unique")) {
      const existing = await executor.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.studioId, context.studioId),
          eq(aiRuns.requestKey, requestKey)
        ),
      });
      if (existing?.result) return existing.result as ClientSummaryOutput;
    }
  }

  try {
    const result = await withBoundedRetry(() =>
      provider.generateStructured(
        {
          systemPrompt,
          prompt,
          schema: ClientSummaryOutputSchema,
        },
        promptVersion
      )
    );

    // Guard suggested actions with deterministic post-processing
    const { guardedActions } = guardSuggestedActions(
      result.data.suggestedActions,
      {
        hasMedicalReviewRequired: promptInput.medicalAlertsSummary.length > 0,
      }
    );

    const safeOutput: ClientSummaryOutput = {
      ...result.data,
      suggestedActions: guardedActions,
    };

    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "completed",
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          model: result.model,
          result: safeOutput,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }

    return safeOutput;
  } catch (error: any) {
    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }
    throw error;
  }
}

export async function generateConversationSummary(
  executor: any,
  context: StudioUserContext,
  conversationId: string,
  requestKey?: string
): Promise<ConversationSummaryOutput> {
  const rateLimitKey = `${context.studioId}:${context.userId}`;
  const rateCheck = globalAiRateLimiter.checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    throw new AiRateLimitError(
      `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetInMs / 1000)} seconds.`
    );
  }

  if (requestKey) {
    const existing = await executor.query.aiRuns.findFirst({
      where: and(
        eq(aiRuns.studioId, context.studioId),
        eq(aiRuns.requestKey, requestKey)
      ),
    });
    if (existing && existing.status === "completed" && existing.result) {
      return existing.result as ConversationSummaryOutput;
    }
  }

  const promptInput = await assembleConversationContext(
    executor,
    context.studioId,
    conversationId
  );

  const { systemPrompt, prompt, promptVersion } = buildConversationSummaryPrompt(promptInput);
  const provider = getAiProvider();

  let runId: string | undefined;
  try {
    const [inserted] = await executor
      .insert(aiRuns)
      .values({
        studioId: context.studioId,
        userId: context.userId,
        feature: "conversation_summary",
        entityType: "conversation",
        entityId: conversationId,
        status: "started",
        provider: provider.name,
        model: "copilot-v1",
        promptVersion,
        requestKey: requestKey || null,
      })
      .returning({ id: aiRuns.id });
    runId = inserted?.id;
  } catch (err: any) {
    if (requestKey && String(err).includes("unique")) {
      const existing = await executor.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.studioId, context.studioId),
          eq(aiRuns.requestKey, requestKey)
        ),
      });
      if (existing?.result) return existing.result as ConversationSummaryOutput;
    }
  }

  try {
    const result = await withBoundedRetry(() =>
      provider.generateStructured(
        {
          systemPrompt,
          prompt,
          schema: ConversationSummaryOutputSchema,
        },
        promptVersion
      )
    );

    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "completed",
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          model: result.model,
          result: result.data,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }

    return result.data;
  } catch (error: any) {
    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }
    throw error;
  }
}

export async function generateReplyDraft(
  executor: any,
  context: StudioUserContext,
  conversationId: string,
  tone?: "professional" | "empathetic" | "concise",
  requestKey?: string
): Promise<ReplyDraftOutput> {
  const rateLimitKey = `${context.studioId}:${context.userId}`;
  const rateCheck = globalAiRateLimiter.checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    throw new AiRateLimitError(
      `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetInMs / 1000)} seconds.`
    );
  }

  if (requestKey) {
    const existing = await executor.query.aiRuns.findFirst({
      where: and(
        eq(aiRuns.studioId, context.studioId),
        eq(aiRuns.requestKey, requestKey)
      ),
    });
    if (existing && existing.status === "completed" && existing.result) {
      return existing.result as ReplyDraftOutput;
    }
  }

  const promptInput = await assembleReplyDraftContext(
    executor,
    context.studioId,
    conversationId,
    tone
  );

  const { systemPrompt, prompt, promptVersion } = buildReplyDraftPrompt(promptInput);
  const provider = getAiProvider();

  let runId: string | undefined;
  try {
    const [inserted] = await executor
      .insert(aiRuns)
      .values({
        studioId: context.studioId,
        userId: context.userId,
        feature: "reply_draft",
        entityType: "conversation",
        entityId: conversationId,
        status: "started",
        provider: provider.name,
        model: "copilot-v1",
        promptVersion,
        requestKey: requestKey || null,
      })
      .returning({ id: aiRuns.id });
    runId = inserted?.id;
  } catch (err: any) {
    if (requestKey && String(err).includes("unique")) {
      const existing = await executor.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.studioId, context.studioId),
          eq(aiRuns.requestKey, requestKey)
        ),
      });
      if (existing?.result) return existing.result as ReplyDraftOutput;
    }
  }

  try {
    const result = await withBoundedRetry(() =>
      provider.generateStructured(
        {
          systemPrompt,
          prompt,
          schema: ReplyDraftOutputSchema,
        },
        promptVersion
      )
    );

    const { sanitizedReply } = sanitizeReplyDraft(result.data.draftReply);
    const safeOutput: ReplyDraftOutput = {
      ...result.data,
      draftReply: sanitizedReply,
    };

    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "completed",
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          model: result.model,
          result: safeOutput,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }

    return safeOutput;
  } catch (error: any) {
    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }
    throw error;
  }
}

export async function generateNextActionSuggestions(
  executor: any,
  context: StudioUserContext,
  clientId: string,
  cycleId?: string | null,
  requestKey?: string
): Promise<NextActionSuggestionsOutput> {
  const rateLimitKey = `${context.studioId}:${context.userId}`;
  const rateCheck = globalAiRateLimiter.checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    throw new AiRateLimitError(
      `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetInMs / 1000)} seconds.`
    );
  }

  if (requestKey) {
    const existing = await executor.query.aiRuns.findFirst({
      where: and(
        eq(aiRuns.studioId, context.studioId),
        eq(aiRuns.requestKey, requestKey)
      ),
    });
    if (existing && existing.status === "completed" && existing.result) {
      return existing.result as NextActionSuggestionsOutput;
    }
  }

  const promptInput = await assembleNextActionContext(
    executor,
    context.studioId,
    clientId,
    cycleId
  );

  const { systemPrompt, prompt, promptVersion } = buildNextActionPrompt(promptInput);
  const provider = getAiProvider();

  let runId: string | undefined;
  try {
    const [inserted] = await executor
      .insert(aiRuns)
      .values({
        studioId: context.studioId,
        userId: context.userId,
        feature: "next_action_suggestion",
        entityType: cycleId ? "treatment_cycle" : "client",
        entityId: cycleId || clientId,
        status: "started",
        provider: provider.name,
        model: "copilot-v1",
        promptVersion,
        requestKey: requestKey || null,
      })
      .returning({ id: aiRuns.id });
    runId = inserted?.id;
  } catch (err: any) {
    if (requestKey && String(err).includes("unique")) {
      const existing = await executor.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.studioId, context.studioId),
          eq(aiRuns.requestKey, requestKey)
        ),
      });
      if (existing?.result) return existing.result as NextActionSuggestionsOutput;
    }
  }

  try {
    const result = await withBoundedRetry(() =>
      provider.generateStructured(
        {
          systemPrompt,
          prompt,
          schema: NextActionSuggestionsOutputSchema,
        },
        promptVersion
      )
    );

    const { guardedActions } = guardSuggestedActions(
      result.data.suggestedActions,
      {
        medicalClearanceStatus: promptInput.medicalEligibility,
        consentStatus: promptInput.consentStatus,
        cycleStage: promptInput.stage,
      }
    );

    const safeOutput: NextActionSuggestionsOutput = {
      ...result.data,
      suggestedActions: guardedActions,
    };

    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "completed",
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          model: result.model,
          result: safeOutput,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }

    return safeOutput;
  } catch (error: any) {
    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }
    throw error;
  }
}

export async function explainNeedsAttentionItem(
  executor: any,
  context: StudioUserContext,
  itemInput: NeedsAttentionPromptInput,
  requestKey?: string
): Promise<NeedsAttentionExplainOutput> {
  const rateLimitKey = `${context.studioId}:${context.userId}`;
  const rateCheck = globalAiRateLimiter.checkRateLimit(rateLimitKey);
  if (!rateCheck.allowed) {
    throw new AiRateLimitError(
      `Rate limit exceeded. Please wait ${Math.ceil(rateCheck.resetInMs / 1000)} seconds.`
    );
  }

  if (requestKey) {
    const existing = await executor.query.aiRuns.findFirst({
      where: and(
        eq(aiRuns.studioId, context.studioId),
        eq(aiRuns.requestKey, requestKey)
      ),
    });
    if (existing && existing.status === "completed" && existing.result) {
      return existing.result as NeedsAttentionExplainOutput;
    }
  }

  const { systemPrompt, prompt, promptVersion } = buildNeedsAttentionPrompt(itemInput);
  const provider = getAiProvider();

  let runId: string | undefined;
  try {
    const [inserted] = await executor
      .insert(aiRuns)
      .values({
        studioId: context.studioId,
        userId: context.userId,
        feature: "needs_attention_explain",
        entityType: "needs_attention_item",
        entityId: itemInput.reasonCode || "attention_item",
        status: "started",
        provider: provider.name,
        model: "copilot-v1",
        promptVersion,
        requestKey: requestKey || null,
      })
      .returning({ id: aiRuns.id });
    runId = inserted?.id;
  } catch (err: any) {
    if (requestKey && String(err).includes("unique")) {
      const existing = await executor.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.studioId, context.studioId),
          eq(aiRuns.requestKey, requestKey)
        ),
      });
      if (existing?.result) return existing.result as NeedsAttentionExplainOutput;
    }
  }

  try {
    const result = await withBoundedRetry(() =>
      provider.generateStructured(
        {
          systemPrompt,
          prompt,
          schema: NeedsAttentionExplainOutputSchema,
        },
        promptVersion
      )
    );

    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "completed",
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          model: result.model,
          result: result.data,
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }

    return result.data;
  } catch (error: any) {
    if (runId) {
      await executor
        .update(aiRuns)
        .set({
          status: "failed",
          error: error?.message || String(error),
          completedAt: new Date(),
        })
        .where(eq(aiRuns.id, runId));
    }
    throw error;
  }
}

export async function getStudioAiUsageSummary(
  executor: any,
  studioId: string
): Promise<{
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  featureBreakdown: Record<string, number>;
}> {
  const runs = await executor.query.aiRuns.findMany({
    where: eq(aiRuns.studioId, studioId),
    orderBy: [desc(aiRuns.createdAt)],
    limit: 100,
  });

  const totalRuns = runs.length;
  let completedRuns = 0;
  let failedRuns = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const featureBreakdown: Record<string, number> = {};

  for (const run of runs) {
    if (run.status === "completed") completedRuns++;
    if (run.status === "failed") failedRuns++;
    totalInputTokens += run.inputTokens || 0;
    totalOutputTokens += run.outputTokens || 0;
    featureBreakdown[run.feature] = (featureBreakdown[run.feature] || 0) + 1;
  }

  return {
    totalRuns,
    completedRuns,
    failedRuns,
    totalInputTokens,
    totalOutputTokens,
    featureBreakdown,
  };
}
