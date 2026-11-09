import { z } from "zod";

export const sendManualMessageSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
  conversationId: z.string().uuid("Invalid conversation ID").optional(),
  cycleId: z.string().uuid("Invalid treatment cycle ID").optional(),
  body: z.string().trim().min(1, "Message body cannot be empty").max(5000, "Message body is too long"),
  requestKey: z.string().uuid("Invalid request key").optional(),
});

export type SendManualMessageInput = z.infer<typeof sendManualMessageSchema>;

export const recordInboundMessageSchema = z.object({
  studioId: z.string().uuid("Invalid studio ID"),
  clientId: z.string().uuid("Invalid client ID"),
  conversationId: z.string().uuid("Invalid conversation ID").optional(),
  cycleId: z.string().uuid("Invalid treatment cycle ID").optional(),
  channel: z.enum(["MANUAL", "WHATSAPP", "SMS", "EMAIL"]),
  body: z.string().trim().min(1, "Message body cannot be empty").max(10000, "Message body is too long"),
  providerMessageId: z.string().trim().min(1).optional(),
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
  sentAt: z.coerce.date().optional(),
  receivedAt: z.coerce.date().optional(),
});

export type RecordInboundMessageInput = z.infer<typeof recordInboundMessageSchema>;

export const assignConversationSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  assignedUserId: z.string().nullable(),
  reason: z.string().trim().min(1).max(500).default("manual_assignment"),
  requestKey: z.string().uuid("Invalid request key").optional(),
});

export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

export const closeConversationSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  reason: z.string().trim().min(1).max(500).default("conversation_closed"),
  requestKey: z.string().uuid("Invalid request key").optional(),
});

export type CloseConversationInput = z.infer<typeof closeConversationSchema>;

export const reopenConversationSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  reason: z.string().trim().min(1).max(500).default("conversation_reopened"),
  requestKey: z.string().uuid("Invalid request key").optional(),
});

export type ReopenConversationInput = z.infer<typeof reopenConversationSchema>;

export const markConversationReadSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  messageId: z.string().uuid("Invalid message ID").optional(),
});

export type MarkConversationReadInput = z.infer<typeof markConversationReadSchema>;
