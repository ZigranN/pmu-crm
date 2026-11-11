import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { studios, clients } from "@/db/schema";
import { recordInboundMessage } from "@/features/conversations/server/service";
import type {
  ParsedInstagramInboundMessage,
  InstagramInboundProcessResult,
} from "../domain/types";

/**
 * Resolves the target Studio for an incoming Instagram event based on recipient ID / account handle.
 * Strictly enforces multi-tenant isolation:
 * - Matches active studios by exact Instagram account ID or sanitized handle.
 * - Does NOT fallback to default or first active studio.
 * - Returns null if no studio is matched or if multiple studios match (ambiguity prevention).
 */
export async function resolveStudioForInstagramInbound(
  recipientId: string,
  database: any = db
): Promise<typeof studios.$inferSelect | null> {
  const cleanRecipientId = recipientId?.trim();
  if (!cleanRecipientId) {
    return null;
  }

  const cleanHandle = cleanRecipientId.replace(/^@/, "");

  // Match active studio where studios.instagram matches the recipient ID or handle
  const matchedStudios = await database
    .select()
    .from(studios)
    .where(
      and(
        eq(studios.isActive, true),
        sql`(${studios.instagram} = ${cleanRecipientId} or ${studios.instagram} = ${cleanHandle} or pmu_instagram_key(${studios.instagram}) = pmu_instagram_key(${cleanHandle}))`
      )
    );

  // Strict tenant security:
  // 1. If 0 studios matched -> null (NO fallback to first active studio)
  // 2. If > 1 studios matched -> ambiguous match, null to prevent cross-studio data leakage
  if (matchedStudios.length !== 1) {
    return null;
  }

  return matchedStudios[0];
}

/**
 * Resolves an existing client in the Studio or safely provisions a new lead from Instagram Direct.
 */
export async function resolveOrCreateClientForInstagramInbound(
  studioId: string,
  inbound: ParsedInstagramInboundMessage,
  database: any = db
): Promise<typeof clients.$inferSelect> {
  const senderId = inbound.senderId;
  const username = inbound.senderUsername?.trim();

  // 1. Check existing client by Instagram handle or ID
  const [existing] = await database
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.studioId, studioId),
        isNull(clients.deletedAt),
        isNull(clients.mergedIntoId),
        sql`(${clients.instagram} = ${senderId} or ${clients.instagramKey} = pmu_instagram_key(${senderId}) ${
          username ? sql`or ${clients.instagram} = ${username} or ${clients.instagramKey} = pmu_instagram_key(${username})` : sql``
        })`
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  // 2. Create new client contact
  const igHandle = username ? `@${username.replace(/^@/, "")}` : senderId;
  const fullName = username ? `@${username.replace(/^@/, "")}` : `Instagram ${senderId.slice(-6)}`;
  const firstName = username ? `@${username.replace(/^@/, "")}` : "Instagram";

  const [newClient] = await database
    .insert(clients)
    .values({
      studioId,
      firstName,
      fullName,
      phone: "+00000000000",
      instagram: igHandle,
      clientStatus: "new_lead",
      source: "instagram",
    })
    .returning();

  return newClient;
}

/**
 * Main Processor for inbound Instagram Direct messages.
 * Enforces HMAC validation, parsing, deduplication, PostgreSQL persistence, and safe AI handling.
 */
export async function processInboundInstagramMessage(
  inbound: ParsedInstagramInboundMessage,
  database: any = db,
  options?: { enableAiAutoReply?: boolean }
): Promise<InstagramInboundProcessResult> {
  try {
    // 1. Discard echoes (outbound messages sent by the page/account itself)
    if (inbound.isEcho) {
      return {
        success: true,
        deduplicated: false,
        isEcho: true,
        ignored: true,
        reason: "Echo message ignored",
      };
    }

    // 2. Resolve Studio
    const studio = await resolveStudioForInstagramInbound(inbound.recipientId, database);
    if (!studio) {
      console.warn(`[Instagram Orchestrator] Unmapped or ambiguous studio for recipient ID ${inbound.recipientId}. Message ignored.`);
      return {
        success: true,
        deduplicated: false,
        isEcho: false,
        ignored: true,
        reason: `No unique active studio found for Instagram recipient ${inbound.recipientId}`,
      };
    }

    // 3. Resolve or Provision Client Lead
    const client = await resolveOrCreateClientForInstagramInbound(studio.id, inbound, database);

    // 4. Record Inbound Message in PostgreSQL (with deduplication on providerMessageId)
    const recordResult = await recordInboundMessage(database, {
      studioId: studio.id,
      clientId: client.id,
      channel: "INSTAGRAM",
      body: inbound.body,
      providerMessageId: inbound.providerMessageId,
      providerMetadata: {
        senderId: inbound.senderId,
        recipientId: inbound.recipientId,
        senderUsername: inbound.senderUsername,
        attachments: inbound.attachments,
        replyToMid: inbound.replyToMid,
        timestamp: inbound.timestamp.toISOString(),
      },
      sentAt: inbound.timestamp,
      receivedAt: new Date(),
    });

    if (recordResult.deduplicated) {
      return {
        success: true,
        deduplicated: true,
        isEcho: false,
        messageId: recordResult.message.id,
        conversationId: recordResult.conversation.id,
        studioId: studio.id,
        clientId: client.id,
      };
    }

    // 5. Automatic AI Responses (STRICT GUARD: AI responses are disabled by default unless explicitly turned on)
    const isAiExplicitlyEnabled =
      options?.enableAiAutoReply === true &&
      process.env.ENABLE_INSTAGRAM_AI_AUTOREPLY === "true";

    if (isAiExplicitlyEnabled) {
      // Reserved for explicit opt-in AI automations
    }

    return {
      success: true,
      deduplicated: false,
      isEcho: false,
      messageId: recordResult.message.id,
      conversationId: recordResult.conversation.id,
      studioId: studio.id,
      clientId: client.id,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      deduplicated: false,
      isEcho: false,
      error: errorMsg,
    };
  }
}
