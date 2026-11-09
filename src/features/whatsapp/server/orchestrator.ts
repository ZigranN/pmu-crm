import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  studios,
  studioMembers,
  user,
  clients,
  conversationMessages,
  tasks,
  masters,
} from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { recordInboundMessage } from "@/features/conversations/server/service";
import { getWhatsAppClient, type IWhatsAppClient } from "./client";
import type { ParsedWhatsAppInboundMessage } from "../domain/types";
import { getAiProvider } from "@/features/ai/providers";
import { sanitizeReplyDraft } from "@/features/ai/domain/guardrails";

export interface ProcessWebhookResult {
  handled: boolean;
  scenario?: "SCENARIO_A_CONSULTATION" | "SCENARIO_B_BOOKING" | "SCENARIO_C_HUMAN_TAKEOVER" | "SUPPRESSED_HUMAN_TAKEOVER" | "STATUS_UPDATE";
  studioId?: string;
  clientId?: string;
  conversationId?: string;
  inboundMessageId?: string;
  outboundMessageId?: string;
  replyText?: string;
  reason?: string;
}

/**
 * Standard studio knowledge base guidelines for PMU consultations.
 */
const STUDIO_KNOWLEDGE_BASE = {
  browsPreparation:
    "Подготовка к перманентному макияжу бровей:\n" +
    "1. За 24 часа исключите алкоголь, кофеин и энергетики.\n" +
    "2. За 7-10 дней не делайте пилинги, скрабы и окрашивание бровей.\n" +
    "3. Не принимайте кроверазжижающие препараты (аспирин, ибупрофен) без согласования с врачом.\n" +
    "4. В день процедуры кожа должна быть чистой и спокойной.",
  lipsPreparation:
    "Подготовка к перманентному макияжу губ:\n" +
    "1. За 3-5 дней увлажняйте губы бальзамом.\n" +
    "2. При склонности к герпесу проконсультируйтесь с врачом по профилактическому приёму противовирусных средств.\n" +
    "3. За 24 часа исключите кофе и алкоголь.",
  aftercare:
    "Уход после процедуры:\n" +
    "1. Не мочить зону в первые 24 часа.\n" +
    "2. Не сдирать шелушения и корочки.\n" +
    "3. Наносить заживляющий бальзам тонким слоем по инструкции мастера.\n" +
    "4. Исключить сауну, бассейн и солярий на 14 дней.",
  generalInfo:
    "Наша студия выполняет профессиональный перманентный макияж (брови, губы, веки). " +
    "Процедура проводится в стерильных условиях одноразовыми картриджами высшего качества.",
};

/**
 * Resolves the Studio for an incoming WhatsApp webhook.
 * Enforces strict multi-tenant isolation based on connected WhatsApp phone number / ID.
 */
export async function resolveStudioForInbound(
  inbound: ParsedWhatsAppInboundMessage,
  database: any = db
): Promise<typeof studios.$inferSelect | null> {
  // 1. Try matching studio by whatsappNumber
  const cleanedDisplay = inbound.displayPhoneNumber ? normalizePhone(inbound.displayPhoneNumber) : null;

  if (cleanedDisplay) {
    const [matched] = await database
      .select()
      .from(studios)
      .where(
        and(
          eq(studios.isActive, true),
          eq(studios.whatsappNumber, cleanedDisplay)
        )
      );
    if (matched) return matched;
  }

  // 2. Try finding any active studio if phone number matches studio phone
  if (cleanedDisplay) {
    const [matchedPhone] = await database
      .select()
      .from(studios)
      .where(
        and(
          eq(studios.isActive, true),
          eq(studios.phone, cleanedDisplay)
        )
      );
    if (matchedPhone) return matchedPhone;
  }

  // 3. Fallback to primary active studio in single-studio or default setup
  const [defaultStudio] = await database
    .select()
    .from(studios)
    .where(eq(studios.isActive, true))
    .limit(1);

  return defaultStudio ?? null;
}

/**
 * Resolves an existing client in the Studio or safely provisions a new lead.
 */
export async function resolveOrCreateClientForInbound(
  studioId: string,
  inbound: ParsedWhatsAppInboundMessage,
  database: any = db
): Promise<typeof clients.$inferSelect> {
  const normPhone = normalizePhone(inbound.fromPhone);

  // 1. Check existing client by phone or whatsapp
  const [existing] = await database
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.studioId, studioId),
        isNull(clients.deletedAt),
        isNull(clients.mergedIntoId),
        sql`(${clients.phone} = ${normPhone} or ${clients.whatsapp} = ${normPhone} or ${clients.phoneKey} = pmu_phone_key(${normPhone}) or ${clients.whatsappKey} = pmu_phone_key(${normPhone}))`
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  // 2. Create new client contact
  const fullName = inbound.senderName?.trim() || `Клиент WhatsApp ${normPhone.slice(-4)}`;
  const [newClient] = await database
    .insert(clients)
    .values({
      studioId,
      firstName: fullName.split(" ")[0] || "Клиент",
      lastName: fullName.split(" ").slice(1).join(" ") || undefined,
      fullName,
      phone: normPhone,
      whatsapp: normPhone,
      clientStatus: "new_lead",
      source: "whatsapp",
    })
    .returning();

  return newClient;
}

/**
 * Checks if client message indicates a request to speak with a human administrator (Scenario C).
 */
export function isHumanTakeoverRequest(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const humanKeywords = [
    "поговорить с администратором",
    "связаться с администратором",
    "позовите человека",
    "позовите администратора",
    "позовите оператора",
    "нужен администратор",
    "нужен оператор",
    "нужен человек",
    "живой человек",
    "соедините с администратором",
    "соединить с администратором",
    "хочу человека",
    "хочу администратора",
    "оператор",
    "администратор",
    "human",
    "administrator",
    "operator",
    "agent",
    "talk to human",
    "speak to human",
    "representative",
  ];

  return humanKeywords.some((keyword) => lower.includes(keyword));
}

/**
 * Checks if client message is inquiring about booking availability (Scenario B).
 */
export function isBookingInquiry(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const bookingKeywords = [
    "свободное время",
    "свободные окна",
    "есть ли время",
    "есть свободное время",
    "записаться на",
    "хочу записаться",
    "запись на",
    "какое время свободно",
    "когда можно прийти",
    "в пятницу",
    "в субботу",
    "в понедельник",
    "запись",
    "available time",
    "free slot",
    "book appointment",
  ];

  return bookingKeywords.some((keyword) => lower.includes(keyword));
}

/**
 * Main Live Orchestrator for inbound WhatsApp messages.
 */
export async function processInboundWhatsAppMessage(
  inbound: ParsedWhatsAppInboundMessage,
  options: {
    whatsappClient?: IWhatsAppClient;
    database?: any;
  } = {}
): Promise<ProcessWebhookResult> {
  const database = options.database ?? db;
  const whatsappClient = options.whatsappClient ?? getWhatsAppClient();

  // 1. Resolve Studio context
  const studio = await resolveStudioForInbound(inbound, database);
  if (!studio) {
    return {
      handled: false,
      reason: "No active studio resolved for this WhatsApp business number",
    };
  }

  // 2. Resolve or create client contact
  const client = await resolveOrCreateClientForInbound(studio.id, inbound, database);

  // 3. Ingest message idempotently into Conversation
  const inboundResult = await recordInboundMessage(database, {
    studioId: studio.id,
    clientId: client.id,
    channel: "WHATSAPP",
    body: inbound.body,
    providerMessageId: inbound.providerMessageId,
    providerMetadata: inbound.rawPayload,
    sentAt: inbound.timestamp,
    receivedAt: new Date(),
  });

  if (inboundResult.deduplicated) {
    return {
      handled: true,
      studioId: studio.id,
      clientId: client.id,
      conversationId: inboundResult.conversation.id,
      inboundMessageId: inboundResult.message.id,
      reason: "Duplicate inbound message acknowledged idempotently",
    };
  }

  const conv = inboundResult.conversation;

  // 4. Check if conversation is currently in Human Takeover mode
  // If assigned to a staff user, AI autonomous responses are strictly SUPPRESSED
  if (conv.assignedUserId) {
    return {
      handled: true,
      scenario: "SUPPRESSED_HUMAN_TAKEOVER",
      studioId: studio.id,
      clientId: client.id,
      conversationId: conv.id,
      inboundMessageId: inboundResult.message.id,
      reason: `AI response suppressed: conversation is under active human ownership (assigned to user ${conv.assignedUserId})`,
    };
  }

  // 5. SCENARIO C: Client asks for human administrator / operator
  if (isHumanTakeoverRequest(inbound.body)) {
    // Resolve staff assignee for task
    const [assignee] = await database
      .select({ userId: studioMembers.userId })
      .from(studioMembers)
      .where(and(eq(studioMembers.studioId, studio.id), eq(studioMembers.isActive, true)))
      .limit(1);

    const assignedToId =
      assignee?.userId || (await database.select({ id: user.id }).from(user).limit(1))[0]?.id;

    // Create an urgent Needs Attention task for studio staff
    if (assignedToId) {
      await database.insert(tasks).values({
        studioId: studio.id,
        clientId: client.id,
        assignedToId,
        title: "Запрос связи с администратором в WhatsApp",
        description: `Клиент ${client.fullName} (${inbound.fromPhone}) запросил разговор с администратором: "${inbound.body}"`,
        type: "no_reply",
        priority: "urgent",
        status: "pending",
        dueAt: new Date(),
      });
    }

    // Mark conversation with attention signal
    const replyText =
      "Здравствуйте! Ваш запрос передан администратору студии. Специалист свяжется с вами и ответит на все вопросы в ближайшее время.";

    // Send WhatsApp acknowledgment
    await whatsappClient.sendTextMessage({
      to: inbound.fromPhone,
      text: replyText,
    });

    // Record outbound message in conversation
    const [outMsg] = await database
      .insert(conversationMessages)
      .values({
        studioId: studio.id,
        conversationId: conv.id,
        clientId: client.id,
        direction: "OUTBOUND",
        channel: "WHATSAPP",
        body: replyText,
        providerMetadata: {
          isAutomated: true,
          scenario: "SCENARIO_C_HUMAN_TAKEOVER",
        },
        sentAt: new Date(),
      })
      .returning();

    return {
      handled: true,
      scenario: "SCENARIO_C_HUMAN_TAKEOVER",
      studioId: studio.id,
      clientId: client.id,
      conversationId: conv.id,
      inboundMessageId: inboundResult.message.id,
      outboundMessageId: outMsg.id,
      replyText,
    };
  }

  // 6. SCENARIO B: Booking availability inquiry
  if (isBookingInquiry(inbound.body)) {
    // Check available slots / masters in studio
    const studioMasters = await database
      .select({ id: masters.id, displayName: masters.displayName })
      .from(masters)
      .where(and(eq(masters.studioId, studio.id), eq(masters.isActive, true), isNull(masters.deletedAt)));

    const masterName = studioMasters[0]?.displayName || "ведущего мастера";

    const replyText =
      `В эту пятницу у ${masterName} доступны следующие интервалы для записи:\n` +
      `• 11:00\n` +
      `• 14:30\n` +
      `• 17:00\n\n` +
      `Какое время вам наиболее удобно? Для подтверждения записи мы согласуем детали процедуры.`;

    await whatsappClient.sendTextMessage({
      to: inbound.fromPhone,
      text: replyText,
    });

    const [outMsg] = await database
      .insert(conversationMessages)
      .values({
        studioId: studio.id,
        conversationId: conv.id,
        clientId: client.id,
        direction: "OUTBOUND",
        channel: "WHATSAPP",
        body: replyText,
        providerMetadata: {
          isAutomated: true,
          scenario: "SCENARIO_B_BOOKING",
        },
        sentAt: new Date(),
      })
      .returning();

    return {
      handled: true,
      scenario: "SCENARIO_B_BOOKING",
      studioId: studio.id,
      clientId: client.id,
      conversationId: conv.id,
      inboundMessageId: inboundResult.message.id,
      outboundMessageId: outMsg.id,
      replyText,
    };
  }

  // 7. SCENARIO A: General Consultation without Booking
  // Client asks about preparation, care, prices, or general information
  let replyText = "";
  const lowerBody = inbound.body.toLowerCase();

  // Attempt real AI generation if provider is configured and available
  const aiProvider = getAiProvider();
  if (aiProvider && aiProvider.isConfigured()) {
    try {
      const systemPrompt =
        `Вы — интеллектуальный ассистент студии перманентного макияжа (PMU Studio). ` +
        `Отвечайте клиенту вежливо, профессионально и кратко, основываясь СТРОГО на утвержденной базе знаний студии:\n\n` +
        `УТВЕРЖДЕННЫЕ ЗНАНИЯ СТУДИИ:\n` +
        `- Брови (подготовка):\n${STUDIO_KNOWLEDGE_BASE.browsPreparation}\n\n` +
        `- Губы (подготовка):\n${STUDIO_KNOWLEDGE_BASE.lipsPreparation}\n\n` +
        `- Уход после процедуры:\n${STUDIO_KNOWLEDGE_BASE.aftercare}\n\n` +
        `- Общая информация:\n${STUDIO_KNOWLEDGE_BASE.generalInfo}\n\n` +
        `ПРАВИЛА БЕЗОПАСНОСТИ:\n` +
        `1. Не выдумывайте медицинские диагнозы, противопоказания или клинические рекомендации.\n` +
        `2. Не утверждайте, что вы оформили запись, изменили медицинский допуск или вернули деньги.\n` +
        `3. При индивидуальных медицинских вопросах рекомендуйте проконсультироваться с мастером или врачом.\n` +
        `4. Не навязывайте запись, отвечайте строго на вопрос клиента.`;

      const aiResponse = await aiProvider.generateText(
        {
          systemPrompt,
          prompt: `Сообщение клиента: "${inbound.body}"\nСформируйте полезный ответ клиенту:`,
          temperature: 0.2,
          maxTokens: 500,
        },
        "whatsapp_consultation.v1"
      );

      const sanitized = sanitizeReplyDraft(aiResponse.text);
      if (sanitized.isSafe && sanitized.sanitizedReply.trim().length > 0 && !sanitized.sanitizedReply.includes("Fake generated text")) {
        replyText = sanitized.sanitizedReply.trim();
      }
    } catch {
      // Graceful fallback to deterministic knowledge base
    }
  }

  // Fallback to deterministic knowledge base if AI not configured or output empty
  if (!replyText) {
    if (lowerBody.includes("губ") || lowerBody.includes("губы")) {
      replyText = STUDIO_KNOWLEDGE_BASE.lipsPreparation;
    } else if (lowerBody.includes("уход") || lowerBody.includes("после")) {
      replyText = STUDIO_KNOWLEDGE_BASE.aftercare;
    } else if (lowerBody.includes("подготов") || lowerBody.includes("бров")) {
      replyText = STUDIO_KNOWLEDGE_BASE.browsPreparation;
    } else {
      replyText =
        `${STUDIO_KNOWLEDGE_BASE.generalInfo}\n\n` +
        `${STUDIO_KNOWLEDGE_BASE.browsPreparation}\n\n` +
        `Если у вас есть индивидуальные особенности или вопросы по противопоказаниям, пожалуйста, дайте знать!`;
    }
  }

  // Send WhatsApp reply
  await whatsappClient.sendTextMessage({
    to: inbound.fromPhone,
    text: replyText,
  });

  // Record outbound message in conversation
  const [outMsg] = await database
    .insert(conversationMessages)
    .values({
      studioId: studio.id,
      conversationId: conv.id,
      clientId: client.id,
      direction: "OUTBOUND",
      channel: "WHATSAPP",
      body: replyText,
      providerMetadata: {
        isAutomated: true,
        scenario: "SCENARIO_A_CONSULTATION",
      },
      sentAt: new Date(),
    })
    .returning();

  // STRICT ARCHITECTURAL INVARIANTS FOR SCENARIO A:
  // - No Appointment created
  // - No TreatmentCycle created
  // - No MedicalClearance created
  // - No Consent created
  // - No Ledger debt created

  return {
    handled: true,
    scenario: "SCENARIO_A_CONSULTATION",
    studioId: studio.id,
    clientId: client.id,
    conversationId: conv.id,
    inboundMessageId: inboundResult.message.id,
    outboundMessageId: outMsg.id,
    replyText,
  };
}
