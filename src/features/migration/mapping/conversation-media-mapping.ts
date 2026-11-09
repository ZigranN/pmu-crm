import type {
  LegacyConversationInput,
  LegacyMessageInput,
  LegacyMediaInput,
  MigrationFinding,
} from "../types";

export interface NormalizedConversationRecord {
  sourceId: string;
  clientId: string;
  channel: string;
  externalThreadId: string | null;
  createdAt: Date;
}

export interface NormalizedMessageRecord {
  sourceId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  sender: string | null;
  providerMessageId: string | null;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface NormalizedMediaRecord {
  sourceId: string;
  clientId: string;
  appointmentId: string | null;
  procedureId: string | null;
  consentId: string | null;
  type: string;
  filePath: string;
  url: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  contentType: string | null;
  createdAt: Date;
  fileExists: boolean;
}

export function normalizeLegacyConversation(
  input: LegacyConversationInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedConversationRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "CONVERSATION_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "conversation",
      sourceId: input.id,
      message: `Conversation ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  let createdAt = new Date();
  if (input.createdAt) {
    const d = new Date(input.createdAt);
    if (!isNaN(d.getTime())) createdAt = d;
  }

  const normalized: NormalizedConversationRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    channel: input.channel || "whatsapp",
    externalThreadId: input.externalThreadId || null,
    createdAt,
  };

  return { normalized, findings };
}

export function normalizeLegacyMessage(
  input: LegacyMessageInput,
  options: {
    conversationSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedMessageRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.conversationSourceIdToTargetId.has(input.conversationId)) {
    findings.push({
      code: "MESSAGE_UNRESOLVED_CONVERSATION",
      severity: "ERROR",
      entityType: "message",
      sourceId: input.id,
      message: `Message ${input.id} references unmapped conversation ${input.conversationId}`,
    });
    return { normalized: null, findings };
  }

  let timestamp = new Date();
  if (input.timestamp) {
    const d = new Date(input.timestamp);
    if (!isNaN(d.getTime())) timestamp = d;
  }

  const normalized: NormalizedMessageRecord = {
    sourceId: input.id,
    conversationId: input.conversationId,
    direction: input.direction === "inbound" ? "inbound" : "outbound",
    channel: input.channel || "whatsapp",
    body: input.body || "",
    sender: input.sender || null,
    providerMessageId: input.providerMessageId || null,
    timestamp,
    metadata: {
      ...input.metadata,
      isHistoricalImport: true,
      deliveredThroughLiveProvider: false, // Strict: historical messages must not be marked as sent via current provider
    },
  };

  return { normalized, findings };
}

export function normalizeLegacyMedia(
  input: LegacyMediaInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
    appointmentSourceIdToTargetId: Map<string, string>;
    procedureSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedMediaRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "MEDIA_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "media",
      sourceId: input.id,
      message: `Media ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // Missing media classification
  if (!input.fileExists) {
    if (input.type === "consent") {
      findings.push({
        code: "MISSING_SIGNED_CONSENT_MEDIA_BLOCKER",
        severity: "BLOCKER",
        entityType: "media",
        sourceId: input.id,
        message: `Missing signed consent media file '${input.filePath}' for client ${input.clientId}. Missing evidentiary consent blocks cutover.`,
        details: { filePath: input.filePath, type: input.type },
      });
    } else if (input.type === "before" || input.type === "after") {
      findings.push({
        code: "MISSING_PROCEDURE_EVIDENCE_MEDIA",
        severity: "ERROR",
        entityType: "media",
        sourceId: input.id,
        message: `Missing procedure photo '${input.filePath}' for procedure ${input.procedureId || "unknown"}.`,
        details: { filePath: input.filePath, type: input.type },
      });
    } else {
      findings.push({
        code: "MISSING_GENERAL_CLIENT_MEDIA",
        severity: "WARNING",
        entityType: "media",
        sourceId: input.id,
        message: `Missing general media file '${input.filePath}' for client ${input.clientId}.`,
        details: { filePath: input.filePath, type: input.type },
      });
    }
  }

  let createdAt = new Date();
  if (input.createdAt) {
    const d = new Date(input.createdAt);
    if (!isNaN(d.getTime())) createdAt = d;
  }

  const normalized: NormalizedMediaRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    appointmentId: input.appointmentId ? (options.appointmentSourceIdToTargetId.get(input.appointmentId) || input.appointmentId) : null,
    procedureId: input.procedureId ? (options.procedureSourceIdToTargetId.get(input.procedureId) || input.procedureId) : null,
    consentId: input.consentId || null,
    type: input.type || "general",
    filePath: input.filePath,
    url: input.url || null,
    sha256: input.sha256 || null,
    sizeBytes: input.sizeBytes || null,
    contentType: input.contentType || "image/jpeg",
    createdAt,
    fileExists: input.fileExists,
  };

  return { normalized, findings };
}
