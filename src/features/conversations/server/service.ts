import "server-only";
import { randomUUID } from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  conversationMessages,
  conversationReadStates,
  clients,
  treatmentCycles,
  studioMembers,
  studios,
} from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getStudioRole } from "@/lib/roles";
import { lockStudioAccess, resourceScope } from "@/server/auth/scopes";
import { writeAudit } from "@/server/services/audit-log.service";
import type { Transaction } from "@/server/commands/ownership";
import {
  dispatchAutomationTrigger,
  cancelPendingAutomations,
} from "@/features/automations/server/engine";
import {
  getInstagramClient,
  classifyInstagramError,
  InstagramApiError,
} from "@/features/instagram/server/client";
import { getActiveInstagramTokenForStudio } from "@/features/instagram/server/service";
import {
  getWhatsAppClient,
  classifyWhatsAppError,
  WhatsAppApiError,
} from "@/features/whatsapp/server/client";
import type { WhatsAppSendMessageResponse } from "@/features/whatsapp/domain/types";
import { canonicalPhone } from "@/lib/phone";
import { logger } from "@/lib/observability/logger";
import {
  sendManualMessageSchema,
  recordInboundMessageSchema,
  assignConversationSchema,
  closeConversationSchema,
  reopenConversationSchema,
  markConversationReadSchema,
  type SendManualMessageInput,
  type RecordInboundMessageInput,
  type AssignConversationInput,
  type CloseConversationInput,
  type ReopenConversationInput,
  type MarkConversationReadInput,
} from "../schemas/conversation.schema";

export type ConversationContext = {
  studioId: string;
  userId: string;
};

function isPlaceholderPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return true;
  if (/^0+$/.test(digits)) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  if (/^1234567\d*$/.test(digits)) return true;
  return false;
}

async function executeInTransaction<T>(
  dbExecutor: typeof db | Transaction,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  if ("transaction" in dbExecutor && typeof dbExecutor.transaction === "function") {
    return (dbExecutor as typeof db).transaction(fn);
  }
  return fn(dbExecutor as Transaction);
}

/**
 * Get or create the primary active conversation for a Studio + Client.
 * Concurrency-safe against race conditions.
 */
export async function getOrCreateClientConversation(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  clientId: string,
  cycleId?: string | null
): Promise<typeof conversations.$inferSelect> {
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (!role || role === "CLIENT" || role === "AI_SYSTEM") {
      throw new Error("Permission denied");
    }

    const scope = await resourceScope(context, tx);

    // Validate client belongs to studio, not soft-deleted, not merged
    const [client] = await tx
      .select({ id: clients.id, mergedIntoId: clients.mergedIntoId })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.studioId, context.studioId),
          isNull(clients.deletedAt),
          scope.client
        )
      )
      .for("update");

    if (!client) {
      throw new Error("Client not found in this studio");
    }
    if (client.mergedIntoId) {
      throw new Error("Client has been merged");
    }

    // If cycleId provided, validate it belongs to same studio AND same client
    if (cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id, clientId: treatmentCycles.clientId })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, cycleId),
            eq(treatmentCycles.studioId, context.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );

      if (!cycle) {
        throw new Error("Treatment cycle not found in this studio");
      }
      if (cycle.clientId !== clientId) {
        throw new Error("Treatment cycle does not belong to this client");
      }
    }

    // Check if conversation already exists for this client and studio
    const [existing] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.studioId, context.studioId),
          eq(conversations.clientId, clientId)
        )
      )
      .for("update");

    if (existing) {
      if (cycleId && existing.cycleId !== cycleId) {
        const [updated] = await tx
          .update(conversations)
          .set({ cycleId, updatedAt: new Date() })
          .where(eq(conversations.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }

    // Insert on conflict to guarantee deterministic race safety
    const [created] = await tx
      .insert(conversations)
      .values({
        studioId: context.studioId,
        clientId,
        cycleId: cycleId ?? null,
        status: "OPEN",
      })
      .onConflictDoUpdate({
        target: [conversations.studioId, conversations.clientId],
        set: { updatedAt: new Date() },
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "conversation_created",
      entityType: "conversation",
      entityId: created.id,
      before: null,
      after: {
        id: created.id,
        clientId,
        cycleId: cycleId ?? null,
        status: created.status,
      },
      reason: "conversation_initialized",
      reasonSource: "user",
    });

    return created;
  });
}

/**
 * Send / log an internal or manual outbound message from staff.
 */
export async function sendManualMessage(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  input: SendManualMessageInput,
  options?: { correlationId?: string }
): Promise<{
  message: typeof conversationMessages.$inferSelect;
  conversation: typeof conversations.$inferSelect;
}> {
  const parsed = sendManualMessageSchema.parse(input);
  const outboundChannel = parsed.channel ?? "MANUAL";
  const correlationId = options?.correlationId || randomUUID();

  let providerMessageId: string | null = null;
  let providerMetadata: Record<string, unknown> | null = null;

  if (outboundChannel === "INSTAGRAM") {
    // 1. Preflight read phase (outside transaction when dbExecutor is db)
    const [lastInboundIg] = await dbExecutor
      .select()
      .from(conversationMessages)
      .where(
        and(
          parsed.conversationId ? eq(conversationMessages.conversationId, parsed.conversationId) : undefined,
          eq(conversationMessages.studioId, context.studioId),
          eq(conversationMessages.clientId, parsed.clientId),
          eq(conversationMessages.direction, "INBOUND"),
          eq(conversationMessages.channel, "INSTAGRAM")
        )
      )
      .orderBy(desc(conversationMessages.sentAt))
      .limit(1);

    const metadata = lastInboundIg?.providerMetadata as
      | { senderId?: string }
      | null;

    const recipientId = metadata?.senderId;

    if (!lastInboundIg) {
      providerMessageId = null;
      providerMetadata = {
        recipientId: null,
        sentViaApi: false,
        deliveryStatus: "failed",
        sendError: "Instagram: входящая переписка с клиентом не найдена.",
        errorCode: "THREAD_NOT_FOUND",
        failureStage: "preflight_validation",
      };
      logger.warn("Instagram outbound preflight failed: no inbound message found", {
        correlationId,
        studioId: context.studioId,
        userId: context.userId,
        channel: "INSTAGRAM",
        operation: "outbound_message",
        status: "failed",
        failureStage: "preflight_validation",
        errorCode: "THREAD_NOT_FOUND",
      });
    } else if (!recipientId || !/^\d+$/.test(recipientId)) {
      providerMessageId = null;
      providerMetadata = {
        recipientId: null,
        sentViaApi: false,
        deliveryStatus: "failed",
        sendError: "Instagram: отсутствует действительный ID клиента.",
        errorCode: "INVALID_RECIPIENT_ID",
        failureStage: "preflight_validation",
      };
      logger.warn("Instagram outbound preflight failed: invalid recipient id", {
        correlationId,
        studioId: context.studioId,
        userId: context.userId,
        channel: "INSTAGRAM",
        operation: "outbound_message",
        status: "failed",
        failureStage: "preflight_validation",
        errorCode: "INVALID_RECIPIENT_ID",
      });
    } else {
      const studioIgConnection = await getActiveInstagramTokenForStudio(context.studioId);
      const accessToken =
        studioIgConnection?.accessToken ||
        process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
        process.env.META_PAGE_ACCESS_TOKEN ||
        process.env.META_ACCESS_TOKEN;

      if (!accessToken) {
        providerMessageId = null;
        providerMetadata = {
          recipientId,
          sentViaApi: false,
          deliveryStatus: "failed",
          sendError: "Instagram: Access Token не настроен.",
          errorCode: "AUTH_NOT_CONFIGURED",
          failureStage: "auth_configuration",
        };
        logger.warn("Instagram outbound preflight failed: token not configured", {
          correlationId,
          studioId: context.studioId,
          userId: context.userId,
          channel: "INSTAGRAM",
          operation: "outbound_message",
          status: "failed",
          failureStage: "auth_configuration",
          errorCode: "AUTH_NOT_CONFIGURED",
        });
      } else {
        // 2. External Provider Dispatch (outside DB transaction)
        try {
          const sendRes = await getInstagramClient({
            defaultAccessToken: accessToken,
            defaultAccountId: studioIgConnection?.instagramAccountId,
          }).sendTextMessage({
            recipientId,
            text: parsed.body,
            pageAccessToken: accessToken,
            instagramAccountId: studioIgConnection?.instagramAccountId,
          });

          if (!sendRes.messageId) {
            throw new InstagramApiError("Instagram API не подтвердил отправку сообщения.");
          }

          providerMessageId = sendRes.messageId;
          providerMetadata = {
            recipientId,
            sentViaApi: true,
            deliveryStatus: "sent",
            messagingProduct: "instagram",
          };

          logger.info("Instagram outbound message dispatched successfully", {
            correlationId,
            studioId: context.studioId,
            userId: context.userId,
            channel: "INSTAGRAM",
            operation: "outbound_message",
            status: "success",
            providerMessageId,
          });
        } catch (err: unknown) {
          const classified = classifyInstagramError(err);
          providerMessageId = null;
          providerMetadata = {
            recipientId,
            sentViaApi: false,
            deliveryStatus: "failed",
            sendError: classified.formattedMessage,
            errorCode: classified.code !== undefined ? String(classified.code) : classified.errorType,
            errorSubcode: classified.subcode !== undefined ? String(classified.subcode) : null,
            errorType: classified.type || null,
            failureStage: "provider_dispatch",
          };

          logger.error("Instagram outbound message dispatch failed", {
            correlationId,
            studioId: context.studioId,
            userId: context.userId,
            channel: "INSTAGRAM",
            operation: "outbound_message",
            status: "failed",
            failureStage: "provider_dispatch",
            errorCode: classified.code !== undefined ? String(classified.code) : classified.errorType,
            errorSubcode: classified.subcode !== undefined ? String(classified.subcode) : undefined,
            errorType: classified.type,
            errorMessage: classified.sanitizedMessage,
          });
        }
      }
    }
  } else if (outboundChannel === "WHATSAPP") {
    // 1. Preflight read phase (outside transaction when dbExecutor is db)
    const [lastInboundWa] = await dbExecutor
      .select()
      .from(conversationMessages)
      .where(
        and(
          parsed.conversationId ? eq(conversationMessages.conversationId, parsed.conversationId) : undefined,
          eq(conversationMessages.studioId, context.studioId),
          eq(conversationMessages.clientId, parsed.clientId),
          eq(conversationMessages.direction, "INBOUND"),
          eq(conversationMessages.channel, "WHATSAPP")
        )
      )
      .orderBy(desc(conversationMessages.sentAt))
      .limit(1);

    const [clientRecord] = await dbExecutor
      .select({ id: clients.id, phone: clients.phone, whatsapp: clients.whatsapp })
      .from(clients)
      .where(
        and(
          eq(clients.id, parsed.clientId),
          eq(clients.studioId, context.studioId)
        )
      );

    const rawRecipient =
      (lastInboundWa?.providerMetadata as { from?: string; senderPhone?: string } | null)?.from ||
      (lastInboundWa?.providerMetadata as { senderPhone?: string } | null)?.senderPhone ||
      clientRecord?.whatsapp ||
      clientRecord?.phone;

    const recipientPhone = canonicalPhone(rawRecipient);

    if (!recipientPhone || isPlaceholderPhone(recipientPhone)) {
      providerMessageId = null;
      providerMetadata = {
        recipientPhone: null,
        sentViaApi: false,
        deliveryStatus: "failed",
        sendError: "WhatsApp: отсутствует действительный подтвержденный номер телефона клиента.",
        errorCode: "INVALID_RECIPIENT_PHONE",
        failureStage: "preflight_validation",
      };
      logger.warn("WhatsApp outbound preflight failed: invalid recipient phone", {
        correlationId,
        studioId: context.studioId,
        userId: context.userId,
        channel: "WHATSAPP",
        operation: "outbound_message",
        status: "failed",
        failureStage: "preflight_validation",
        errorCode: "INVALID_RECIPIENT_PHONE",
      });
    } else {
      const waClient = getWhatsAppClient();
      if (!waClient.isConfigured()) {
        providerMessageId = null;
        providerMetadata = {
          recipientPhone,
          sentViaApi: false,
          deliveryStatus: "failed",
          sendError: "WhatsApp: Access Token или Phone Number ID не настроены.",
          errorCode: "AUTH_NOT_CONFIGURED",
          failureStage: "auth_configuration",
        };
        logger.warn("WhatsApp outbound preflight failed: credentials not configured", {
          correlationId,
          studioId: context.studioId,
          userId: context.userId,
          channel: "WHATSAPP",
          operation: "outbound_message",
          status: "failed",
          failureStage: "auth_configuration",
          errorCode: "AUTH_NOT_CONFIGURED",
        });
      } else {
        const serviceWindow = waClient.checkServiceWindow(lastInboundWa?.sentAt);

        if (!serviceWindow.isWithin24hWindow && !parsed.templateName) {
          providerMessageId = null;
          providerMetadata = {
            recipientPhone,
            sentViaApi: false,
            deliveryStatus: "failed",
            sendError:
              "WhatsApp: 24-часовое окно для сообщений в свободной форме истекло. Для отправки вне окна требуется утвержденный шаблон.",
            errorCode: "WINDOW_EXPIRED",
            failureStage: "preflight_validation",
            serviceWindow: {
              isWithin24hWindow: false,
              lastInboundAt: serviceWindow.lastInboundAt?.toISOString() ?? null,
              windowExpiresAt: serviceWindow.windowExpiresAt?.toISOString() ?? null,
            },
          };
          logger.warn("WhatsApp outbound preflight failed: 24h window expired", {
            correlationId,
            studioId: context.studioId,
            userId: context.userId,
            channel: "WHATSAPP",
            operation: "outbound_message",
            status: "failed",
            failureStage: "preflight_validation",
            errorCode: "WINDOW_EXPIRED",
          });
        } else {
          // 2. External Provider Dispatch (outside DB transaction)
          try {
            let sendRes: WhatsAppSendMessageResponse;
            if (serviceWindow.isWithin24hWindow) {
              if (parsed.templateName) {
                sendRes = await waClient.sendTemplateMessage({
                  to: recipientPhone,
                  templateName: parsed.templateName,
                  languageCode: parsed.templateLanguage || "ru",
                  components: parsed.templateComponents as Array<Record<string, unknown>> | undefined,
                });
              } else {
                sendRes = await waClient.sendTextMessage({
                  to: recipientPhone,
                  text: parsed.body,
                });
              }
            } else {
              sendRes = await waClient.sendTemplateMessage({
                to: recipientPhone,
                templateName: parsed.templateName!,
                languageCode: parsed.templateLanguage || "ru",
                components: parsed.templateComponents as Array<Record<string, unknown>> | undefined,
              });
            }

            const returnedMessageId = sendRes.messages?.[0]?.id;
            if (!returnedMessageId) {
              throw new WhatsAppApiError("WhatsApp API не подтвердил отправку сообщения.", 500);
            }

            providerMessageId = returnedMessageId;
            providerMetadata = {
              recipientPhone,
              sentViaApi: true,
              deliveryStatus: "sent",
              messagingProduct: sendRes.messagingProduct || "whatsapp",
              isTemplate: Boolean(parsed.templateName),
              templateName: parsed.templateName ?? null,
              serviceWindow: {
                isWithin24hWindow: serviceWindow.isWithin24hWindow,
                lastInboundAt: serviceWindow.lastInboundAt?.toISOString() ?? null,
                windowExpiresAt: serviceWindow.windowExpiresAt?.toISOString() ?? null,
              },
            };

            logger.info("WhatsApp outbound message dispatched successfully", {
              correlationId,
              studioId: context.studioId,
              userId: context.userId,
              channel: "WHATSAPP",
              operation: "outbound_message",
              status: "success",
              providerMessageId,
            });
          } catch (err: unknown) {
            const classified = classifyWhatsAppError(err);
            providerMessageId = null;
            providerMetadata = {
              recipientPhone,
              sentViaApi: false,
              deliveryStatus: "failed",
              sendError: classified.formattedMessage,
              errorCode: classified.code !== undefined ? String(classified.code) : classified.errorType,
              errorSubcode: classified.subcode !== undefined ? String(classified.subcode) : null,
              failureStage: "provider_dispatch",
              serviceWindow: {
                isWithin24hWindow: serviceWindow.isWithin24hWindow,
                lastInboundAt: serviceWindow.lastInboundAt?.toISOString() ?? null,
                windowExpiresAt: serviceWindow.windowExpiresAt?.toISOString() ?? null,
              },
            };

            logger.error("WhatsApp outbound message dispatch failed", {
              correlationId,
              studioId: context.studioId,
              userId: context.userId,
              channel: "WHATSAPP",
              operation: "outbound_message",
              status: "failed",
              failureStage: "provider_dispatch",
              errorCode: classified.code !== undefined ? String(classified.code) : classified.errorType,
              errorSubcode: classified.subcode !== undefined ? String(classified.subcode) : undefined,
              errorMessage: classified.sanitizedMessage,
            });
          }
        }
      }
    }
  }

  // 3. Fast Atomic Database Persistence
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canWrite = await hasPermission(tx, context.userId, context.studioId, "CONVERSATION_WRITE");
    if (!canWrite) {
      throw new Error("Permission denied: cannot write conversation messages");
    }

    // Resolve or create conversation
    const conv = await getOrCreateClientConversation(
      tx,
      context,
      parsed.clientId,
      parsed.cycleId
    );

    if (parsed.conversationId && parsed.conversationId !== conv.id) {
      throw new Error("Conversation ID does not match client active thread");
    }

    // If cycleId provided, validate it
    const targetCycleId = parsed.cycleId ?? conv.cycleId;
    if (parsed.cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id, clientId: treatmentCycles.clientId })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.cycleId),
            eq(treatmentCycles.studioId, context.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );
      if (!cycle || cycle.clientId !== parsed.clientId) {
        throw new Error("Treatment cycle does not belong to this client");
      }
    }

    const now = new Date();

    // Insert immutable message evidence
    const [msg] = await tx
      .insert(conversationMessages)
      .values({
        studioId: context.studioId,
        conversationId: conv.id,
        clientId: parsed.clientId,
        cycleId: targetCycleId,
        direction: "OUTBOUND",
        channel: outboundChannel,
        body: parsed.body,
        senderUserId: context.userId,
        providerMessageId,
        providerMetadata,
        sentAt: now,
      })
      .returning();

    // Update conversation lastMessageAt
    const [updatedConv] = await tx
      .update(conversations)
      .set({
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    // Update sender's read state to this message
    await tx
      .insert(conversationReadStates)
      .values({
        studioId: context.studioId,
        conversationId: conv.id,
        userId: context.userId,
        lastReadMessageId: msg.id,
        lastReadAt: now,
      })
      .onConflictDoUpdate({
        target: [conversationReadStates.conversationId, conversationReadStates.userId],
        set: {
          lastReadMessageId: msg.id,
          lastReadAt: now,
        },
      });

    const isSuccessfulSend = providerMetadata?.sentViaApi === true || outboundChannel === "MANUAL";

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "message_recorded",
      entityType: "conversation_message",
      entityId: msg.id,
      before: null,
      after: {
        id: msg.id,
        conversationId: conv.id,
        clientId: parsed.clientId,
        direction: "OUTBOUND",
        channel: outboundChannel,
        sentAt: now.toISOString(),
        sentViaApi: providerMetadata?.sentViaApi ?? false,
      },
      reason: isSuccessfulSend ? "manual_message_sent" : "manual_message_send_failed",
      reasonSource: "user",
    });

    // Invalidate pending unanswered follow-ups for this conversation ONLY if staff successfully replied
    if (isSuccessfulSend) {
      await cancelPendingAutomations(tx, context.studioId, {
        entityType: "conversation",
        entityId: conv.id,
        reason: "staff_response_sent",
      });
    }

    return {
      message: msg,
      conversation: updatedConv,
    };
  });
}

/**
 * Server-side inbound message ingestion foundation (future provider webhooks).
 */
export async function recordInboundMessage(
  dbExecutor: typeof db | Transaction,
  input: RecordInboundMessageInput
): Promise<{
  message: typeof conversationMessages.$inferSelect;
  conversation: typeof conversations.$inferSelect;
  deduplicated: boolean;
}> {
  const parsed = recordInboundMessageSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    // Lock studio first to enforce strict lock ordering and eliminate deadlocks
    const [studio] = await tx
      .select({ id: studios.id })
      .from(studios)
      .where(and(eq(studios.id, parsed.studioId), eq(studios.isActive, true)))
      .for("update");

    if (!studio) {
      throw new Error("Studio not found or inactive");
    }

    // Deduplicate provider retries if providerMessageId is present
    if (parsed.providerMessageId) {
      const [existingMsg] = await tx
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.studioId, parsed.studioId),
            eq(conversationMessages.providerMessageId, parsed.providerMessageId)
          )
        );

      if (existingMsg) {
        const [existingConv] = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, existingMsg.conversationId));

        return {
          message: existingMsg,
          conversation: existingConv,
          deduplicated: true,
        };
      }
    }

    // Validate client in studio
    const [client] = await tx
      .select({ id: clients.id, mergedIntoId: clients.mergedIntoId })
      .from(clients)
      .where(
        and(
          eq(clients.id, parsed.clientId),
          eq(clients.studioId, parsed.studioId),
          isNull(clients.deletedAt)
        )
      );

    if (!client) {
      throw new Error("Client not found in this studio");
    }

    // Validate cycle if provided
    if (parsed.cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id, clientId: treatmentCycles.clientId })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.cycleId),
            eq(treatmentCycles.studioId, parsed.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );
      if (!cycle || cycle.clientId !== parsed.clientId) {
        throw new Error("Treatment cycle does not belong to this client");
      }
    }

    // Resolve or get/create conversation for client
    let [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.studioId, parsed.studioId),
          eq(conversations.clientId, parsed.clientId)
        )
      )
      .for("update");

    if (!conv) {
      const [newConv] = await tx
        .insert(conversations)
        .values({
          studioId: parsed.studioId,
          clientId: parsed.clientId,
          cycleId: parsed.cycleId ?? null,
          status: "OPEN",
        })
        .onConflictDoUpdate({
          target: [conversations.studioId, conversations.clientId],
          set: { updatedAt: new Date() },
        })
        .returning();
      conv = newConv;
    }

    const sentAt = parsed.sentAt ?? new Date();
    const receivedAt = parsed.receivedAt ?? new Date();

    // Insert immutable inbound message
    const [msg] = await tx
      .insert(conversationMessages)
      .values({
        studioId: parsed.studioId,
        conversationId: conv.id,
        clientId: parsed.clientId,
        cycleId: parsed.cycleId ?? conv.cycleId,
        direction: "INBOUND",
        channel: parsed.channel,
        body: parsed.body,
        providerMessageId: parsed.providerMessageId ?? null,
        providerMetadata: parsed.providerMetadata ?? null,
        sentAt,
        receivedAt,
      })
      .returning();

    // Update conversation lastMessageAt and reopen if closed
    const [updatedConv] = await tx
      .update(conversations)
      .set({
        lastMessageAt: sentAt,
        status: "OPEN", // Reopen conversation on new inbound message (Section 15)
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    // Invalidate stale follow-up and schedule fresh follow-up for this inbound message
    await cancelPendingAutomations(tx, parsed.studioId, {
      entityType: "conversation",
      entityId: conv.id,
      reason: "new_inbound_message_received",
    });

    await dispatchAutomationTrigger(tx, { studioId: parsed.studioId }, {
      type: "CONVERSATION_INBOUND_RECEIVED",
      studioId: parsed.studioId,
      entityType: "conversation",
      entityId: conv.id,
      clientId: parsed.clientId,
      referenceTime: sentAt,
      metadata: { messageId: msg.id, triggerTime: sentAt.toISOString() },
    });

    return {
      message: msg,
      conversation: updatedConv,
      deduplicated: false,
    };
  });
}

/**
 * Mark conversation as read for the current user.
 * Independent per-user read state.
 */
export async function markConversationRead(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  input: MarkConversationReadInput
): Promise<{ success: boolean; conversationId: string; lastReadMessageId: string | null }> {
  const parsed = markConversationReadSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canRead = await hasPermission(tx, context.userId, context.studioId, "CONVERSATION_READ");
    if (!canRead) {
      throw new Error("Permission denied: cannot read conversations");
    }

    const scope = await resourceScope(context, tx);

    const [conv] = await tx
      .select({ id: conversations.id, clientId: conversations.clientId })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, parsed.conversationId),
          eq(conversations.studioId, context.studioId),
          scope.clientReference(sql`${conversations.clientId}`)
        )
      );

    if (!conv) {
      throw new Error("Conversation not found");
    }

    let targetMessageId = parsed.messageId;

    if (!targetMessageId) {
      const [latest] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, parsed.conversationId),
            eq(conversationMessages.studioId, context.studioId)
          )
        )
        .orderBy(desc(conversationMessages.sentAt), desc(conversationMessages.createdAt))
        .limit(1);

      targetMessageId = latest?.id;
    }

    const now = new Date();

    await tx
      .insert(conversationReadStates)
      .values({
        studioId: context.studioId,
        conversationId: parsed.conversationId,
        userId: context.userId,
        lastReadMessageId: targetMessageId ?? null,
        lastReadAt: now,
      })
      .onConflictDoUpdate({
        target: [conversationReadStates.conversationId, conversationReadStates.userId],
        set: {
          lastReadMessageId: targetMessageId ?? null,
          lastReadAt: now,
        },
      });

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "conversation_read",
      entityType: "conversation",
      entityId: parsed.conversationId,
      before: null,
      after: {
        conversationId: parsed.conversationId,
        lastReadMessageId: targetMessageId ?? null,
        lastReadAt: now.toISOString(),
      },
      reason: "conversation_marked_read",
      reasonSource: "user",
    });

    return {
      success: true,
      conversationId: parsed.conversationId,
      lastReadMessageId: targetMessageId ?? null,
    };
  });
}

/**
 * Assign staff member to conversation.
 */
export async function assignConversation(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  input: AssignConversationInput
): Promise<typeof conversations.$inferSelect> {
  const parsed = assignConversationSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canAssign = await hasPermission(tx, context.userId, context.studioId, "CONVERSATION_ASSIGN");
    if (!canAssign) {
      throw new Error("Permission denied: cannot assign conversations");
    }

    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, parsed.conversationId),
          eq(conversations.studioId, context.studioId)
        )
      )
      .for("update");

    if (!conv) {
      throw new Error("Conversation not found");
    }

    // If assigning to a user, verify assignee is active member of this studio
    if (parsed.assignedUserId) {
      const [member] = await tx
        .select()
        .from(studioMembers)
        .where(
          and(
            eq(studioMembers.studioId, context.studioId),
            eq(studioMembers.userId, parsed.assignedUserId),
            eq(studioMembers.isActive, true)
          )
        );

      if (!member) {
        throw new Error("Assigned user must be an active member of this studio");
      }
    }

    const prevAssigned = conv.assignedUserId;

    const [updated] = await tx
      .update(conversations)
      .set({
        assignedUserId: parsed.assignedUserId,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "conversation_assigned",
      entityType: "conversation",
      entityId: conv.id,
      before: { assignedUserId: prevAssigned },
      after: { assignedUserId: parsed.assignedUserId },
      reason: parsed.reason,
      reasonSource: "user",
    });

    return updated;
  });
}

/**
 * Close conversation thread.
 */
export async function closeConversation(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  input: CloseConversationInput
): Promise<typeof conversations.$inferSelect> {
  const parsed = closeConversationSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canWrite = await hasPermission(tx, context.userId, context.studioId, "CONVERSATION_WRITE");
    if (!canWrite) {
      throw new Error("Permission denied: cannot close conversations");
    }

    const scope = await resourceScope(context, tx);

    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, parsed.conversationId),
          eq(conversations.studioId, context.studioId),
          scope.clientReference(sql`${conversations.clientId}`)
        )
      )
      .for("update");

    if (!conv) {
      throw new Error("Conversation not found");
    }

    const prevStatus = conv.status;

    const [updated] = await tx
      .update(conversations)
      .set({
        status: "CLOSED",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "conversation_closed",
      entityType: "conversation",
      entityId: conv.id,
      before: { status: prevStatus },
      after: { status: "CLOSED" },
      reason: parsed.reason,
      reasonSource: "user",
    });

    // Invalidate pending follow-up jobs since conversation is now closed
    await cancelPendingAutomations(tx, context.studioId, {
      entityType: "conversation",
      entityId: conv.id,
      reason: "conversation_closed",
    });

    return updated;
  });
}

/**
 * Reopen conversation thread.
 */
export async function reopenConversation(
  dbExecutor: typeof db | Transaction,
  context: ConversationContext,
  input: ReopenConversationInput
): Promise<typeof conversations.$inferSelect> {
  const parsed = reopenConversationSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canWrite = await hasPermission(tx, context.userId, context.studioId, "CONVERSATION_WRITE");
    if (!canWrite) {
      throw new Error("Permission denied: cannot reopen conversations");
    }

    const scope = await resourceScope(context, tx);

    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, parsed.conversationId),
          eq(conversations.studioId, context.studioId),
          scope.clientReference(sql`${conversations.clientId}`)
        )
      )
      .for("update");

    if (!conv) {
      throw new Error("Conversation not found");
    }

    const prevStatus = conv.status;

    const [updated] = await tx
      .update(conversations)
      .set({
        status: "OPEN",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "conversation_reopened",
      entityType: "conversation",
      entityId: conv.id,
      before: { status: prevStatus },
      after: { status: "OPEN" },
      reason: parsed.reason,
      reasonSource: "user",
    });

    return updated;
  });
}
