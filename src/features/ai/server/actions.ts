"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { PERMISSIONS } from "@/lib/permissions";
import {
  GenerateClientSummaryInputSchema,
  GenerateConversationSummaryInputSchema,
  GenerateReplyDraftInputSchema,
  GenerateNextActionSuggestionsInputSchema,
  ExplainNeedsAttentionInputSchema,
  type GenerateClientSummaryInput,
  type GenerateConversationSummaryInput,
  type GenerateReplyDraftInput,
  type GenerateNextActionSuggestionsInput,
  type ExplainNeedsAttentionInput,
} from "../schemas/ai.schema";
import {
  generateClientSummary,
  generateConversationSummary,
  generateReplyDraft,
  generateNextActionSuggestions,
  explainNeedsAttentionItem,
} from "./service";

export async function generateClientSummaryAction(input: GenerateClientSummaryInput) {
  const parsed = GenerateClientSummaryInputSchema.parse(input);
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_USE);

  const res = await generateClientSummary(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed.clientId,
    parsed.requestKey
  );

  revalidatePath(`/clients/${parsed.clientId}`);
  return res;
}

export async function generateConversationSummaryAction(input: GenerateConversationSummaryInput) {
  const parsed = GenerateConversationSummaryInputSchema.parse(input);
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_USE);

  const res = await generateConversationSummary(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed.conversationId,
    parsed.requestKey
  );

  revalidatePath("/conversations");
  return res;
}

export async function generateReplyDraftAction(input: GenerateReplyDraftInput) {
  const parsed = GenerateReplyDraftInputSchema.parse(input);
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_USE);

  const res = await generateReplyDraft(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed.conversationId,
    parsed.tone,
    parsed.requestKey
  );

  return res;
}

export async function generateNextActionSuggestionsAction(input: GenerateNextActionSuggestionsInput) {
  const parsed = GenerateNextActionSuggestionsInputSchema.parse(input);
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_USE);

  const res = await generateNextActionSuggestions(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed.clientId,
    parsed.cycleId,
    parsed.requestKey
  );

  return res;
}

export async function explainNeedsAttentionAction(input: ExplainNeedsAttentionInput) {
  const parsed = ExplainNeedsAttentionInputSchema.parse(input);
  const context = await requireBrowserStudioPermission(PERMISSIONS.AI_USE);

  const res = await explainNeedsAttentionItem(
    db,
    { studioId: context.studioId, userId: context.userId },
    {
      itemType: "NEEDS_ATTENTION",
      severity: "warning",
      reasonCode: parsed.itemId,
      reasonTitle: "Requires Attention Item",
    },
    parsed.requestKey
  );

  return res;
}
