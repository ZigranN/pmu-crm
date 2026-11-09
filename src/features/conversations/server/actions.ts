"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { idempotentCommand } from "@/server/commands/idempotency";
import {
  sendManualMessageSchema,
  assignConversationSchema,
  closeConversationSchema,
  reopenConversationSchema,
  markConversationReadSchema,
  type SendManualMessageInput,
  type AssignConversationInput,
  type CloseConversationInput,
  type ReopenConversationInput,
  type MarkConversationReadInput,
} from "../schemas/conversation.schema";
import {
  getOrCreateClientConversation,
  sendManualMessage,
  assignConversation,
  closeConversation,
  reopenConversation,
  markConversationRead,
} from "./service";
import {
  listConversations,
  getConversation,
  listConversationMessages,
} from "./queries";
import type { ConversationFilters } from "../domain/types";

export async function getOrCreateClientConversationAction(
  clientId: string,
  cycleId?: string | null
) {
  const context = await requireBrowserStudioContext();
  const conv = await getOrCreateClientConversation(
    db,
    { studioId: context.studioId, userId: context.userId },
    clientId,
    cycleId
  );
  revalidatePath("/conversations");
  revalidatePath(`/clients/${clientId}`);
  return conv;
}

export async function sendManualMessageAction(input: SendManualMessageInput) {
  const parsed = sendManualMessageSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = {
      clientId: parsed.clientId,
      conversationId: parsed.conversationId ?? null,
      cycleId: parsed.cycleId ?? null,
      body: parsed.body,
    };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "CONVERSATION_WRITE",
      "conversation.message.manual.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await sendManualMessage(tx, { studioId: context.studioId, userId: context.userId }, parsed);
        return {
          message: {
            ...res.message,
            sentAt: res.message.sentAt.toISOString(),
            receivedAt: res.message.receivedAt ? res.message.receivedAt.toISOString() : null,
            createdAt: res.message.createdAt.toISOString(),
          },
          conversation: {
            ...res.conversation,
            lastMessageAt: res.conversation.lastMessageAt ? res.conversation.lastMessageAt.toISOString() : null,
            createdAt: res.conversation.createdAt.toISOString(),
            updatedAt: res.conversation.updatedAt.toISOString(),
          },
        } as any;
      },
      async () => {}
    );

    revalidatePath("/conversations");
    revalidatePath(`/clients/${parsed.clientId}`);
    return {
      message: {
        ...serialized.message,
        sentAt: new Date(serialized.message.sentAt),
        receivedAt: serialized.message.receivedAt ? new Date(serialized.message.receivedAt) : null,
        createdAt: new Date(serialized.message.createdAt),
      },
      conversation: {
        ...serialized.conversation,
        lastMessageAt: serialized.conversation.lastMessageAt ? new Date(serialized.conversation.lastMessageAt) : null,
        createdAt: new Date(serialized.conversation.createdAt),
        updatedAt: new Date(serialized.conversation.updatedAt),
      },
    };
  }

  const res = await sendManualMessage(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/conversations");
  revalidatePath(`/clients/${parsed.clientId}`);
  return res;
}

export async function markConversationReadAction(input: MarkConversationReadInput) {
  const parsed = markConversationReadSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await markConversationRead(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/conversations");
  return res;
}

export async function assignConversationAction(input: AssignConversationInput) {
  const parsed = assignConversationSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = {
      conversationId: parsed.conversationId,
      assignedUserId: parsed.assignedUserId,
      reason: parsed.reason,
    };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "CONVERSATION_ASSIGN",
      "conversation.assign.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await assignConversation(tx, { studioId: context.studioId, userId: context.userId }, parsed);
        return {
          ...res,
          lastMessageAt: res.lastMessageAt ? res.lastMessageAt.toISOString() : null,
          createdAt: res.createdAt.toISOString(),
          updatedAt: res.updatedAt.toISOString(),
        } as any;
      },
      async () => {}
    );

    revalidatePath("/conversations");
    return {
      ...serialized,
      lastMessageAt: serialized.lastMessageAt ? new Date(serialized.lastMessageAt) : null,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
    };
  }

  const res = await assignConversation(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/conversations");
  return res;
}

export async function closeConversationAction(input: CloseConversationInput) {
  const parsed = closeConversationSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = {
      conversationId: parsed.conversationId,
      reason: parsed.reason,
    };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "CONVERSATION_WRITE",
      "conversation.close.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await closeConversation(tx, { studioId: context.studioId, userId: context.userId }, parsed);
        return {
          ...res,
          lastMessageAt: res.lastMessageAt ? res.lastMessageAt.toISOString() : null,
          createdAt: res.createdAt.toISOString(),
          updatedAt: res.updatedAt.toISOString(),
        } as any;
      },
      async () => {}
    );

    revalidatePath("/conversations");
    return {
      ...serialized,
      lastMessageAt: serialized.lastMessageAt ? new Date(serialized.lastMessageAt) : null,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
    };
  }

  const res = await closeConversation(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/conversations");
  return res;
}

export async function reopenConversationAction(input: ReopenConversationInput) {
  const parsed = reopenConversationSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = {
      conversationId: parsed.conversationId,
      reason: parsed.reason,
    };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "CONVERSATION_WRITE",
      "conversation.reopen.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await reopenConversation(tx, { studioId: context.studioId, userId: context.userId }, parsed);
        return {
          ...res,
          lastMessageAt: res.lastMessageAt ? res.lastMessageAt.toISOString() : null,
          createdAt: res.createdAt.toISOString(),
          updatedAt: res.updatedAt.toISOString(),
        } as any;
      },
      async () => {}
    );

    revalidatePath("/conversations");
    return {
      ...serialized,
      lastMessageAt: serialized.lastMessageAt ? new Date(serialized.lastMessageAt) : null,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
    };
  }

  const res = await reopenConversation(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/conversations");
  return res;
}

export async function listConversationsAction(filters?: ConversationFilters) {
  const context = await requireBrowserStudioContext();
  return listConversations(context.studioId, filters);
}

export async function getConversationAction(conversationId: string) {
  const context = await requireBrowserStudioContext();
  return getConversation(conversationId, context.studioId);
}

export async function listConversationMessagesAction(
  conversationId: string,
  options?: { limit?: number }
) {
  const context = await requireBrowserStudioContext();
  return listConversationMessages(conversationId, context.studioId, options);
}
