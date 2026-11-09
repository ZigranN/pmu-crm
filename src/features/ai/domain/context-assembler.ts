import {
  clients,
  treatmentCycles,
  appointments,
  ledgerEntries,
  conversationMessages,
  conversations,
  clientMedicalProfiles,
  cycleConsents,
  cycleMedicalClearances,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type { ClientSummaryPromptInput } from "../prompts/client-summary.prompt";
import type { ConversationSummaryPromptInput } from "../prompts/conversation-summary.prompt";
import type { ReplyDraftPromptInput } from "../prompts/reply-draft.prompt";
import type { NextActionPromptInput } from "../prompts/next-action.prompt";

export class ContextRedactor {
  static redactSensitivePatterns(text: string): string {
    if (!text) return "";
    return text
      // Redact credit cards
      .replace(/\b(?:\d[ -]*?){13,16}\b/g, "[REDACTED_PAYMENT_CARD]")
      // Redact potential auth tokens / api keys / secrets
      .replace(/(?:bearer\s+|token[:=]\s*|key[:=]\s*|secret[:=]\s*)[a-zA-Z0-9_\-\.]{16,}/gi, "[REDACTED_SECRET]")
      // Redact base64 image data payloads / signatures
      .replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]{50,}/g, "[REDACTED_SIGNATURE_PAYLOAD]");
  }

  static sanitizeMedicalProfile(profile: any): string[] {
    if (!profile) return [];
    const alerts: string[] = [];
    if (
      profile.allergies &&
      typeof profile.allergies === "string" &&
      profile.allergies.trim() &&
      !/^(none|нет|no|n\/a)$/i.test(profile.allergies.trim())
    ) {
      alerts.push(`Allergies reported: ${this.redactSensitivePatterns(profile.allergies.trim())}`);
    }
    if (
      profile.contraindications &&
      typeof profile.contraindications === "string" &&
      profile.contraindications.trim() &&
      !/^(none|нет|no|n\/a)$/i.test(profile.contraindications.trim())
    ) {
      alerts.push(`Reported contraindications: ${this.redactSensitivePatterns(profile.contraindications.trim())}`);
    }
    if (profile.hasDiabetes) alerts.push("Reported condition: Diabetes");
    if (profile.hasKeloids) alerts.push("Reported condition: Keloid tendency");
    if (profile.isPregnant) alerts.push("Reported condition: Pregnancy/Nursing");
    if (profile.hasSkinDiseases) alerts.push("Reported condition: Skin conditions");
    if (profile.mergeReviewRequired) alerts.push("Medical profile requires staff merge review");
    return alerts;
  }
}

export async function assembleClientSummaryContext(
  dbInstance: any,
  studioId: string,
  clientId: string
): Promise<ClientSummaryPromptInput> {
  // 1. Client profile scoped by studioId
  const client = await dbInstance.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.studioId, studioId)),
  });

  if (!client) {
    throw new Error(`Client ${clientId} not found in studio ${studioId}`);
  }

  // 2. Active Treatment Cycles
  const cycles = await dbInstance.query.treatmentCycles.findMany({
    where: and(eq(treatmentCycles.clientId, clientId), eq(treatmentCycles.studioId, studioId)),
    orderBy: [desc(treatmentCycles.createdAt)],
    limit: 5,
  });

  const cycleSummaries = cycles.map((c: any) => ({
    zone: c.zoneCode || "general",
    kind: c.kind || "pmu",
    stage: c.stage,
    stageEnteredAt: c.stageEnteredAt ? new Date(c.stageEnteredAt).toISOString().split("T")[0] : undefined,
  }));

  // 3. Appointments summary (last 5)
  const appts = await dbInstance.query.appointments.findMany({
    where: and(eq(appointments.clientId, clientId), eq(appointments.studioId, studioId)),
    orderBy: [desc(appointments.startAt)],
    limit: 5,
  });

  const recentAppointments = appts.map((a: any) => ({
    date: a.startAt ? new Date(a.startAt).toISOString().split("T")[0] : "unknown",
    serviceName: a.serviceSnapshot?.name || "Service",
    status: a.status,
  }));

  // 4. Financial summary: aggregate payments and charges without raw transaction secrets
  const entries = await dbInstance.query.ledgerEntries.findMany({
    where: and(eq(ledgerEntries.clientId, clientId), eq(ledgerEntries.studioId, studioId)),
  });

  let totalPaidCents = 0;
  let totalChargedCents = 0;
  for (const entry of entries) {
    if (entry.entryType === "PAYMENT" || entry.entryType === "DEPOSIT") {
      totalPaidCents += entry.amountCents || 0;
    } else if (entry.entryType === "CHARGE") {
      totalChargedCents += entry.amountCents || 0;
    } else if (entry.entryType === "REFUND") {
      totalPaidCents -= entry.amountCents || 0;
    }
  }
  const outstandingBalanceCents = Math.max(0, totalChargedCents - totalPaidCents);

  // 5. Medical alerts summary (minimized, no biometric/signature data)
  const medicalProfile = await dbInstance.query.clientMedicalProfiles.findFirst({
    where: eq(clientMedicalProfiles.clientId, clientId),
  });
  const medicalAlertsSummary = ContextRedactor.sanitizeMedicalProfile(medicalProfile);

  // 6. Needs attention reasons (basic deterministic flags)
  const needsAttentionReasons: string[] = [];
  if (client.clientStatus === "requires_attention") {
    needsAttentionReasons.push("Client status is flagged as requiring attention");
  }
  if (medicalProfile?.mergeReviewRequired) {
    needsAttentionReasons.push("Medical profile flagged for merge review");
  }

  // 7. Recent conversation snippets (minimized)
  const recentMsgs = await dbInstance.query.conversationMessages.findMany({
    where: and(eq(conversationMessages.clientId, clientId), eq(conversationMessages.studioId, studioId)),
    orderBy: [desc(conversationMessages.sentAt)],
    limit: 3,
  });

  const recentConversationHighlights = recentMsgs.map((m: any) =>
    ContextRedactor.redactSensitivePatterns(m.body)
  );

  return {
    clientName: client.fullName || `${client.firstName || "Client"}`,
    clientStatus: client.clientStatus,
    cycleSummaries,
    recentAppointments,
    financialSummary: {
      totalPaidCents,
      outstandingBalanceCents,
    },
    needsAttentionReasons,
    medicalAlertsSummary,
    recentConversationHighlights,
  };
}

export async function assembleConversationContext(
  dbInstance: any,
  studioId: string,
  conversationId: string
): Promise<ConversationSummaryPromptInput> {
  const conv = await dbInstance.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.studioId, studioId)),
    with: {
      client: true,
    },
  });

  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found in studio ${studioId}`);
  }

  const msgs = await dbInstance.query.conversationMessages.findMany({
    where: and(
      eq(conversationMessages.conversationId, conversationId),
      eq(conversationMessages.studioId, studioId)
    ),
    orderBy: [conversationMessages.sentAt],
    limit: 30,
  });

  const messages = msgs.map((m: any) => ({
    id: m.id,
    direction: m.direction as "inbound" | "outbound",
    senderName: m.direction === "inbound" ? conv.client?.fullName : "Staff",
    body: ContextRedactor.redactSensitivePatterns(m.body),
    sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : "unknown",
  }));

  return {
    clientName: conv.client?.fullName || "Client",
    messages,
  };
}

export async function assembleReplyDraftContext(
  dbInstance: any,
  studioId: string,
  conversationId: string,
  tone?: "professional" | "empathetic" | "concise"
): Promise<ReplyDraftPromptInput> {
  const convContext = await assembleConversationContext(dbInstance, studioId, conversationId);
  const conv = await dbInstance.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.studioId, studioId)),
  });

  let relevantContext: ReplyDraftPromptInput["relevantContext"] = undefined;
  if (conv?.clientId) {
    const nextAppt = await dbInstance.query.appointments.findFirst({
      where: and(
        eq(appointments.clientId, conv.clientId),
        eq(appointments.studioId, studioId)
      ),
      orderBy: [desc(appointments.startAt)],
    });

    relevantContext = {
      nextAppointment: nextAppt?.startAt ? new Date(nextAppt.startAt).toLocaleString() : undefined,
      serviceName: nextAppt?.serviceSnapshot?.name,
    };
  }

  return {
    clientName: convContext.clientName,
    tone,
    recentMessages: convContext.messages.slice(-10),
    relevantContext,
  };
}

export async function assembleNextActionContext(
  dbInstance: any,
  studioId: string,
  clientId: string,
  cycleId?: string | null
): Promise<NextActionPromptInput> {
  const client = await dbInstance.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.studioId, studioId)),
  });

  if (!client) {
    throw new Error(`Client ${clientId} not found in studio ${studioId}`);
  }

  let cycle: any = null;
  if (cycleId) {
    cycle = await dbInstance.query.treatmentCycles.findFirst({
      where: and(eq(treatmentCycles.id, cycleId), eq(treatmentCycles.studioId, studioId)),
    });
  } else {
    cycle = await dbInstance.query.treatmentCycles.findFirst({
      where: and(eq(treatmentCycles.clientId, clientId), eq(treatmentCycles.studioId, studioId)),
      orderBy: [desc(treatmentCycles.createdAt)],
    });
  }

  // Medical clearance status
  let medicalEligibility: NextActionPromptInput["medicalEligibility"] = "UNKNOWN";
  if (cycle?.id) {
    const clearance = await dbInstance.query.cycleMedicalClearances.findFirst({
      where: and(eq(cycleMedicalClearances.cycleId, cycle.id), eq(cycleMedicalClearances.studioId, studioId)),
      orderBy: [desc(cycleMedicalClearances.createdAt)],
    });
    if (clearance) {
      medicalEligibility = clearance.status === "CLEARED" ? "ELIGIBLE" : clearance.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "INELIGIBLE";
    }
  }

  // Consent status
  let consentStatus: NextActionPromptInput["consentStatus"] = "PENDING";
  if (cycle?.id) {
    const consent = await dbInstance.query.cycleConsents.findFirst({
      where: and(eq(cycleConsents.cycleId, cycle.id), eq(cycleConsents.studioId, studioId)),
      orderBy: [desc(cycleConsents.createdAt)],
    });
    if (consent) {
      consentStatus = consent.status === "COMPLETED" ? "SIGNED" : "PENDING";
    }
  }

  // Upcoming appointment
  const nextAppt = await dbInstance.query.appointments.findFirst({
    where: and(
      eq(appointments.clientId, clientId),
      eq(appointments.studioId, studioId)
    ),
    orderBy: [desc(appointments.startAt)],
  });

  return {
    clientName: client.fullName || client.firstName || "Client",
    stage: cycle?.stage,
    medicalEligibility,
    consentStatus,
    hasUpcomingAppointment: Boolean(nextAppt && nextAppt.status !== "cancelled"),
    upcomingAppointmentDate: nextAppt?.startAt ? new Date(nextAppt.startAt).toLocaleString() : undefined,
    needsAttentionReasons: client.clientStatus === "requires_attention" ? ["Client requires attention"] : [],
    unreadInboundMessagesCount: 0,
    balanceCents: 0,
  };
}
