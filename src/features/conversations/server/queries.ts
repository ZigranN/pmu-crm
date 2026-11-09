import "server-only";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  conversationMessages,
  conversationReadStates,
  clients,
  treatmentCycles,
  user,
} from "@/db/schema";
import { sensitiveRead, recordIds, optionalRecordId } from "@/server/services/access-log.service";
import { resourceScope } from "@/server/auth/scopes";
import type {
  ConversationListItem,
  ConversationFilters,
  ConversationMessageRecord,
  ConversationAttentionSignals,
} from "../domain/types";
import type { ConversationContext } from "./service";

/**
 * List conversations for the inbox UI with client details, assigned staff,
 * last message preview, and unread counts for the current viewer.
 */
export async function listConversationsForContext(
  context: ConversationContext,
  filters?: ConversationFilters
): Promise<ConversationListItem[]> {
  const scope = await resourceScope(context);

  // Fetch conversations scoped to studio and master access
  const convRows = await db
    .select({
      conversation: conversations,
      client: {
        id: clients.id,
        fullName: clients.fullName,
        firstName: clients.firstName,
        phone: clients.phone,
      },
      assignedUser: {
        id: user.id,
        name: user.name,
      },
      cycle: {
        id: treatmentCycles.id,
        zoneCode: treatmentCycles.zoneCode,
      },
      readState: {
        lastReadMessageId: conversationReadStates.lastReadMessageId,
        lastReadAt: conversationReadStates.lastReadAt,
      },
    })
    .from(conversations)
    .innerJoin(
      clients,
      and(
        eq(clients.id, conversations.clientId),
        eq(clients.studioId, conversations.studioId),
        isNull(clients.deletedAt)
      )
    )
    .leftJoin(
      user,
      eq(user.id, conversations.assignedUserId)
    )
    .leftJoin(
      treatmentCycles,
      and(
        eq(treatmentCycles.id, conversations.cycleId),
        eq(treatmentCycles.studioId, conversations.studioId),
        isNull(treatmentCycles.archivedAt)
      )
    )
    .leftJoin(
      conversationReadStates,
      and(
        eq(conversationReadStates.conversationId, conversations.id),
        eq(conversationReadStates.userId, context.userId)
      )
    )
    .where(
      and(
        eq(conversations.studioId, context.studioId),
        scope.client,
        filters?.clientId ? eq(conversations.clientId, filters.clientId) : undefined,
        filters?.status ? eq(conversations.status, filters.status) : undefined,
        filters?.assignedToMe ? eq(conversations.assignedUserId, context.userId) : undefined
      )
    )
    .orderBy(
      desc(conversations.lastMessageAt),
      desc(conversations.id)
    );

  const items: ConversationListItem[] = [];

  for (const row of convRows) {
    // Fetch last message for preview
    const [lastMsg] = await db
      .select({
        id: conversationMessages.id,
        body: conversationMessages.body,
        channel: conversationMessages.channel,
        direction: conversationMessages.direction,
        sentAt: conversationMessages.sentAt,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversation.id),
          eq(conversationMessages.studioId, context.studioId)
        )
      )
      .orderBy(
        desc(conversationMessages.sentAt),
        desc(conversationMessages.createdAt),
        desc(conversationMessages.id)
      )
      .limit(1);

    // Calculate unread count for current user:
    // INBOUND messages with sentAt > readState.lastReadAt (or all inbound messages if readState is null)
    let unreadCount = 0;
    if (row.readState?.lastReadAt) {
      const [unreadRes] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, row.conversation.id),
            eq(conversationMessages.studioId, context.studioId),
            eq(conversationMessages.direction, "INBOUND"),
            gt(conversationMessages.sentAt, row.readState.lastReadAt)
          )
        );
      unreadCount = unreadRes?.count ?? 0;
    } else {
      const [unreadRes] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, row.conversation.id),
            eq(conversationMessages.studioId, context.studioId),
            eq(conversationMessages.direction, "INBOUND")
          )
        );
      unreadCount = unreadRes?.count ?? 0;
    }

    // Apply channel filter if requested
    if (filters?.channel && lastMsg?.channel !== filters.channel) {
      continue;
    }

    // Apply unreadOnly filter if requested
    if (filters?.unreadOnly && unreadCount === 0) {
      continue;
    }

    // Apply search filter if requested
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase().trim();
      const matchName = row.client.fullName?.toLowerCase().includes(searchLower) ||
        row.client.firstName?.toLowerCase().includes(searchLower);
      const matchPhone = row.client.phone?.includes(filters.search.trim());
      if (!matchName && !matchPhone) {
        continue;
      }
    }

    items.push({
      id: row.conversation.id,
      studioId: row.conversation.studioId,
      clientId: row.client.id,
      clientName: row.client.fullName || row.client.firstName || "Без имени",
      clientPhone: row.client.phone,
      cycleId: row.cycle?.id ?? null,
      cycleZoneCode: row.cycle?.zoneCode ?? null,
      assignedUserId: row.assignedUser?.id ?? null,
      assignedUserName: row.assignedUser?.name ?? null,
      status: row.conversation.status,
      lastMessageAt: lastMsg?.sentAt ?? row.conversation.lastMessageAt ?? row.conversation.createdAt,
      lastMessagePreview: lastMsg?.body ?? null,
      lastMessageChannel: lastMsg?.channel ?? null,
      lastMessageDirection: lastMsg?.direction ?? null,
      unreadCount,
      createdAt: row.conversation.createdAt,
      updatedAt: row.conversation.updatedAt,
    });
  }

  return items;
}

/**
 * List conversations wrapped with sensitiveRead logging.
 */
export async function listConversations(
  studioId: string,
  filters?: ConversationFilters
): Promise<ConversationListItem[]> {
  return sensitiveRead(
    "CONVERSATION_READ",
    studioId,
    { operation: "conversations.list" },
    async (context) => {
      return listConversationsForContext(context, filters);
    },
    recordIds
  );
}

/**
 * Get detailed conversation metadata and current viewer unread count.
 */
export async function getConversationForContext(
  context: ConversationContext,
  conversationId: string
) {
  const scope = await resourceScope(context);

  const [row] = await db
    .select({
      conversation: conversations,
      client: {
        id: clients.id,
        fullName: clients.fullName,
        firstName: clients.firstName,
        phone: clients.phone,
      },
      assignedUser: {
        id: user.id,
        name: user.name,
      },
      cycle: {
        id: treatmentCycles.id,
        zoneCode: treatmentCycles.zoneCode,
      },
      readState: {
        lastReadMessageId: conversationReadStates.lastReadMessageId,
        lastReadAt: conversationReadStates.lastReadAt,
      },
    })
    .from(conversations)
    .innerJoin(
      clients,
      and(
        eq(clients.id, conversations.clientId),
        eq(clients.studioId, conversations.studioId),
        isNull(clients.deletedAt)
      )
    )
    .leftJoin(user, eq(user.id, conversations.assignedUserId))
    .leftJoin(
      treatmentCycles,
      and(
        eq(treatmentCycles.id, conversations.cycleId),
        eq(treatmentCycles.studioId, conversations.studioId),
        isNull(treatmentCycles.archivedAt)
      )
    )
    .leftJoin(
      conversationReadStates,
      and(
        eq(conversationReadStates.conversationId, conversations.id),
        eq(conversationReadStates.userId, context.userId)
      )
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.studioId, context.studioId),
        scope.client
      )
    );

  if (!row) {
    return null;
  }

  // Calculate unread count
  let unreadCount = 0;
  if (row.readState?.lastReadAt) {
    const [unreadRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversation.id),
          eq(conversationMessages.studioId, context.studioId),
          eq(conversationMessages.direction, "INBOUND"),
          gt(conversationMessages.sentAt, row.readState.lastReadAt)
        )
      );
    unreadCount = unreadRes?.count ?? 0;
  } else {
    const [unreadRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversation.id),
          eq(conversationMessages.studioId, context.studioId),
          eq(conversationMessages.direction, "INBOUND")
        )
      );
    unreadCount = unreadRes?.count ?? 0;
  }

  return {
    ...row.conversation,
    client: row.client,
    assignedUser: row.assignedUser,
    cycle: row.cycle,
    unreadCount,
    lastReadAt: row.readState?.lastReadAt ?? null,
  };
}

/**
 * Get conversation wrapped with sensitiveRead logging.
 */
export async function getConversation(
  conversationId: string,
  studioId: string
) {
  return sensitiveRead(
    "CONVERSATION_READ",
    studioId,
    { operation: "conversation.read", targetId: conversationId },
    async (context) => {
      const conv = await getConversationForContext(context, conversationId);
      if (!conv) {
        throw new Error("Conversation not found");
      }
      return conv;
    },
    optionalRecordId
  );
}

/**
 * List message timeline for a conversation.
 * Deterministic message ordering: sentAt ASC, createdAt ASC, id ASC.
 */
export async function listConversationMessagesForContext(
  context: ConversationContext,
  conversationId: string,
  options?: { limit?: number }
): Promise<ConversationMessageRecord[]> {
  const scope = await resourceScope(context);

  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(
      clients,
      and(
        eq(clients.id, conversations.clientId),
        eq(clients.studioId, conversations.studioId),
        isNull(clients.deletedAt)
      )
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.studioId, context.studioId),
        scope.client
      )
    );

  if (!conv) {
    throw new Error("Conversation not found");
  }

  const query = db
    .select({
      message: conversationMessages,
      sender: {
        id: user.id,
        name: user.name,
      },
    })
    .from(conversationMessages)
    .leftJoin(user, eq(user.id, conversationMessages.senderUserId))
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.studioId, context.studioId)
      )
    )
    .orderBy(
      asc(conversationMessages.sentAt),
      asc(conversationMessages.createdAt),
      asc(conversationMessages.id)
    );

  if (options?.limit) {
    query.limit(options.limit);
  }

  const rows = await query;

  return rows.map((r) => ({
    ...r.message,
    senderName: r.sender?.name ?? null,
  }));
}

/**
 * List messages wrapped with sensitiveRead logging.
 */
export async function listConversationMessages(
  conversationId: string,
  studioId: string,
  options?: { limit?: number }
): Promise<ConversationMessageRecord[]> {
  return sensitiveRead(
    "CONVERSATION_READ",
    studioId,
    { operation: "conversations.messages", targetId: conversationId },
    async (context) => {
      return listConversationMessagesForContext(context, conversationId, options);
    },
    recordIds
  );
}

/**
 * Read-side signals for Needs Attention / triage integration:
 * - latestInboundUnanswered
 * - conversation unread
 * - lastOutboundAt
 * - lastInboundAt
 */
export async function getConversationAttentionSignals(
  clientId: string,
  studioId: string
): Promise<ConversationAttentionSignals> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.clientId, clientId),
        eq(conversations.studioId, studioId)
      )
    );

  if (!conv) {
    return {
      conversationId: null,
      conversationStatus: null,
      latestInboundUnanswered: false,
      unreadCount: 0,
      lastOutboundAt: null,
      lastInboundAt: null,
    };
  }

  const [lastMsg] = await db
    .select({
      direction: conversationMessages.direction,
      sentAt: conversationMessages.sentAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conv.id),
        eq(conversationMessages.studioId, studioId)
      )
    )
    .orderBy(
      desc(conversationMessages.sentAt),
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id)
    )
    .limit(1);

  const [lastInbound] = await db
    .select({ sentAt: conversationMessages.sentAt })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conv.id),
        eq(conversationMessages.studioId, studioId),
        eq(conversationMessages.direction, "INBOUND")
      )
    )
    .orderBy(desc(conversationMessages.sentAt))
    .limit(1);

  const [lastOutbound] = await db
    .select({ sentAt: conversationMessages.sentAt })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conv.id),
        eq(conversationMessages.studioId, studioId),
        eq(conversationMessages.direction, "OUTBOUND")
      )
    )
    .orderBy(desc(conversationMessages.sentAt))
    .limit(1);

  const latestInboundUnanswered = lastMsg?.direction === "INBOUND";

  return {
    conversationId: conv.id,
    conversationStatus: conv.status,
    latestInboundUnanswered,
    unreadCount: latestInboundUnanswered ? 1 : 0,
    lastOutboundAt: lastOutbound?.sentAt ?? null,
    lastInboundAt: lastInbound?.sentAt ?? null,
  };
}
