import type { ConversationStatus, MessageDirection, MessageChannel } from "@/db/schema";

export type { ConversationStatus, MessageDirection, MessageChannel };

export interface ConversationRecord {
  id: string;
  studioId: string;
  clientId: string;
  cycleId: string | null;
  assignedUserId: string | null;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessageRecord {
  id: string;
  studioId: string;
  conversationId: string;
  clientId: string;
  cycleId: string | null;
  direction: MessageDirection;
  channel: MessageChannel;
  body: string;
  senderUserId: string | null;
  providerMessageId: string | null;
  providerMetadata: Record<string, unknown> | null;
  sentAt: Date;
  receivedAt: Date | null;
  createdAt: Date;
  senderName?: string | null;
}

export interface ConversationReadStateRecord {
  id: string;
  studioId: string;
  conversationId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: Date;
}

export interface ConversationListItem {
  id: string;
  studioId: string;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  cycleId: string | null;
  cycleZoneCode?: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageChannel: MessageChannel | null;
  lastMessageDirection: MessageDirection | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationFilters {
  assignedToMe?: boolean;
  unreadOnly?: boolean;
  clientId?: string;
  channel?: MessageChannel;
  status?: ConversationStatus;
  search?: string;
}

export interface ConversationAttentionSignals {
  conversationId: string | null;
  conversationStatus: ConversationStatus | null;
  latestInboundUnanswered: boolean;
  unreadCount: number;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
}
