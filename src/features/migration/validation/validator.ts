import type {
  LegacySourceDataset,
  MigrationConfiguration,
  MigrationFinding,
  MigrationSeverity,
  FinancialReconciliationReport,
  EntityMigrationCounts,
} from "../types";
import { normalizeLegacyClient, type NormalizedClientRecord } from "../mapping/client-mapping";
import { normalizeLegacyCycle, expandTotalFacePackage, type NormalizedCycleRecord } from "../mapping/cycle-mapping";
import { normalizeLegacyAppointment, detectAppointmentConflicts, type NormalizedAppointmentRecord } from "../mapping/appointment-mapping";
import {
  normalizeLegacyMedicalProfile,
  normalizeLegacyMedicalClearance,
  normalizeLegacyConsent,
  type NormalizedMedicalProfileRecord,
  type NormalizedMedicalClearanceRecord,
  type NormalizedConsentRecord,
} from "../mapping/medical-consent-mapping";
import { normalizeLegacyProcedure, type NormalizedProcedureRecord } from "../mapping/procedure-mapping";
import {
  normalizeLegacyFinance,
  computeFinancialReconciliation,
  type NormalizedFinanceRecord,
} from "../mapping/finance-mapping";
import {
  normalizeLegacyConversation,
  normalizeLegacyMessage,
  normalizeLegacyMedia,
  type NormalizedConversationRecord,
  type NormalizedMessageRecord,
  type NormalizedMediaRecord,
} from "../mapping/conversation-media-mapping";

export interface StagingValidationResult {
  clients: NormalizedClientRecord[];
  cycles: NormalizedCycleRecord[];
  appointments: NormalizedAppointmentRecord[];
  medicalProfiles: NormalizedMedicalProfileRecord[];
  medicalClearances: NormalizedMedicalClearanceRecord[];
  consents: NormalizedConsentRecord[];
  procedures: NormalizedProcedureRecord[];
  finances: NormalizedFinanceRecord[];
  conversations: NormalizedConversationRecord[];
  messages: NormalizedMessageRecord[];
  media: NormalizedMediaRecord[];
  counts: Record<string, EntityMigrationCounts>;
  findings: MigrationFinding[];
  findingCounts: Record<MigrationSeverity, number>;
  financialReconciliation: FinancialReconciliationReport;
  cutoverReadiness: {
    ready: boolean;
    blockers: string[];
  };
}

export function validateAndStageDataset(
  dataset: LegacySourceDataset,
  config: MigrationConfiguration
): StagingValidationResult {
  const findings: MigrationFinding[] = [];

  // ID Resolution maps (source ID -> target ID)
  const clientSourceIdToTargetId = new Map<string, string>();
  const cycleSourceIdToTargetId = new Map<string, string>();
  const appointmentSourceIdToTargetId = new Map<string, string>();
  const conversationSourceIdToTargetId = new Map<string, string>();
  const procedureSourceIdToTargetId = new Map<string, string>();
  const staffSourceIdToTargetId = new Map<string, string>();

  // Populate staff mappings
  if (dataset.staff) {
    for (const staff of dataset.staff) {
      const rule = config.staffMappings[staff.id] || config.staffMappings[staff.name];
      if (rule?.targetMasterId || rule?.targetUserId) {
        staffSourceIdToTargetId.set(staff.id, rule.targetMasterId || rule.targetUserId!);
      }
    }
  }

  // 1. STAGE CLIENTS
  const clients: NormalizedClientRecord[] = [];
  const rawClients = dataset.clients || [];
  const clientsSkipped = 0;
  let clientsRejected = 0;

  for (const rawClient of rawClients) {
    const { normalized, findings: clientFindings } = normalizeLegacyClient(rawClient, clients);
    findings.push(...clientFindings);

    const hasErrors = clientFindings.some((f) => f.severity === "ERROR" || f.severity === "BLOCKER");
    if (hasErrors) {
      clientsRejected++;
    } else {
      clients.push(normalized);
      clientSourceIdToTargetId.set(normalized.sourceId, normalized.sourceId);
    }
  }

  // Client lookup map for names
  const clientMap = new Map<string, { fullName: string }>();
  for (const c of clients) {
    clientMap.set(c.sourceId, { fullName: c.fullName });
  }

  // 2. STAGE CYCLES & TOTAL FACE PACKAGES
  const cycles: NormalizedCycleRecord[] = [];
  const rawCycles = dataset.cycles || [];
  const cyclesSkipped = 0;
  let cyclesRejected = 0;

  for (const rawCycle of rawCycles) {
    const { normalized, findings: cycleFindings } = normalizeLegacyCycle(rawCycle, {
      clientSourceIdToTargetId,
    });
    findings.push(...cycleFindings);

    if (normalized) {
      cycles.push(normalized);
      cycleSourceIdToTargetId.set(normalized.sourceId, normalized.sourceId);
    } else {
      cyclesRejected++;
    }
  }

  // Expand packages into sibling zone cycles if present
  if (dataset.packages) {
    for (const pkg of dataset.packages) {
      const { cycles: siblingCycles, findings: pkgFindings } = expandTotalFacePackage(pkg, {
        clientSourceIdToTargetId,
      });
      findings.push(...pkgFindings);
      for (const sib of siblingCycles) {
        cycles.push(sib);
        cycleSourceIdToTargetId.set(sib.sourceId, sib.sourceId);
      }
    }
  }

  // 3. STAGE APPOINTMENTS
  const appointments: NormalizedAppointmentRecord[] = [];
  const rawAppointments = dataset.appointments || [];
  let appointmentsRejected = 0;

  for (const rawApp of rawAppointments) {
    const { normalized, findings: appFindings } = normalizeLegacyAppointment(rawApp, {
      clientSourceIdToTargetId,
      staffMappings: config.staffMappings,
      serviceMappings: config.serviceMappings,
      defaultTimezone: config.defaultTimezone,
    });
    findings.push(...appFindings);

    if (normalized) {
      appointments.push(normalized);
      appointmentSourceIdToTargetId.set(normalized.sourceId, normalized.sourceId);
    } else {
      appointmentsRejected++;
    }
  }

  // Detect Appointment Conflicts
  const conflictFindings = detectAppointmentConflicts(appointments);
  findings.push(...conflictFindings);

  // 4. STAGE MEDICAL PROFILES & CLEARANCES
  const medicalProfiles: NormalizedMedicalProfileRecord[] = [];
  const rawProfiles = dataset.medicalProfiles || [];
  for (const rawProf of rawProfiles) {
    const { normalized, findings: profFindings } = normalizeLegacyMedicalProfile(rawProf, {
      clientSourceIdToTargetId,
    });
    findings.push(...profFindings);
    if (normalized) medicalProfiles.push(normalized);
  }

  const medicalClearances: NormalizedMedicalClearanceRecord[] = [];
  const rawClearances = dataset.medicalClearances || [];
  for (const rawClearance of rawClearances) {
    const { normalized, findings: clearanceFindings } = normalizeLegacyMedicalClearance(rawClearance, {
      clientSourceIdToTargetId,
      staffSourceIdToTargetId,
    });
    findings.push(...clearanceFindings);
    if (normalized) medicalClearances.push(normalized);
  }

  // 5. STAGE CONSENTS
  const consents: NormalizedConsentRecord[] = [];
  const rawConsents = dataset.consents || [];
  for (const rawConsent of rawConsents) {
    const { normalized, findings: consentFindings } = normalizeLegacyConsent(rawConsent, {
      clientSourceIdToTargetId,
    });
    findings.push(...consentFindings);
    if (normalized) consents.push(normalized);
  }

  // 6. STAGE PROCEDURES
  const procedures: NormalizedProcedureRecord[] = [];
  const rawProcedures = dataset.procedures || [];
  let proceduresRejected = 0;
  for (const rawProc of rawProcedures) {
    const { normalized, findings: procFindings } = normalizeLegacyProcedure(rawProc, {
      clientSourceIdToTargetId,
      appointmentSourceIdToTargetId,
      cycleSourceIdToTargetId,
      staffMappings: config.staffMappings,
    });
    findings.push(...procFindings);
    if (normalized) {
      procedures.push(normalized);
      procedureSourceIdToTargetId.set(normalized.sourceId, normalized.sourceId);
    } else {
      proceduresRejected++;
    }
  }

  // 7. STAGE FINANCES & COMPUTE RECONCILIATION
  const finances: NormalizedFinanceRecord[] = [];
  const rawFinances = dataset.finances || [];
  let financesRejected = 0;
  for (const rawFin of rawFinances) {
    const { normalized, findings: finFindings } = normalizeLegacyFinance(rawFin, {
      clientSourceIdToTargetId,
      appointmentSourceIdToTargetId,
      cycleSourceIdToTargetId,
      authoritativeCurrency: config.currency,
    });
    findings.push(...finFindings);
    if (normalized) {
      finances.push(normalized);
    } else {
      financesRejected++;
    }
  }

  const { report: financialReconciliation, findings: recFindings } = computeFinancialReconciliation(
    rawFinances,
    finances,
    clientMap,
    config.currency
  );
  findings.push(...recFindings);

  // 8. STAGE CONVERSATIONS & MESSAGES
  const conversations: NormalizedConversationRecord[] = [];
  const rawConversations = dataset.conversations || [];
  for (const rawConv of rawConversations) {
    const { normalized, findings: convFindings } = normalizeLegacyConversation(rawConv, {
      clientSourceIdToTargetId,
    });
    findings.push(...convFindings);
    if (normalized) {
      conversations.push(normalized);
      conversationSourceIdToTargetId.set(normalized.sourceId, normalized.sourceId);
    }
  }

  const messages: NormalizedMessageRecord[] = [];
  const rawMessages = dataset.messages || [];
  for (const rawMsg of rawMessages) {
    const { normalized, findings: msgFindings } = normalizeLegacyMessage(rawMsg, {
      conversationSourceIdToTargetId,
    });
    findings.push(...msgFindings);
    if (normalized) messages.push(normalized);
  }

  // 9. STAGE MEDIA
  const media: NormalizedMediaRecord[] = [];
  const rawMedia = dataset.media || [];
  for (const rawMed of rawMedia) {
    const { normalized, findings: medFindings } = normalizeLegacyMedia(rawMed, {
      clientSourceIdToTargetId,
      appointmentSourceIdToTargetId,
      procedureSourceIdToTargetId,
    });
    findings.push(...medFindings);
    if (normalized) media.push(normalized);
  }

  // 10. COMPUTE ENTITY COUNTS & FINDING SEVERITIES
  const findingCounts: Record<MigrationSeverity, number> = {
    BLOCKER: 0,
    ERROR: 0,
    WARNING: 0,
    INFO: 0,
  };

  const blockers: string[] = [];

  for (const finding of findings) {
    findingCounts[finding.severity]++;
    if (finding.severity === "BLOCKER") {
      blockers.push(`[${finding.code}] ${finding.message}`);
    }
  }

  const counts: Record<string, EntityMigrationCounts> = {
    clients: {
      sourceCount: rawClients.length,
      mappedCount: clients.length,
      migratedCount: clients.length,
      skippedCount: clientsSkipped,
      rejectedCount: clientsRejected,
    },
    cycles: {
      sourceCount: rawCycles.length + (dataset.packages?.length || 0),
      mappedCount: cycles.length,
      migratedCount: cycles.length,
      skippedCount: cyclesSkipped,
      rejectedCount: cyclesRejected,
    },
    appointments: {
      sourceCount: rawAppointments.length,
      mappedCount: appointments.length,
      migratedCount: appointments.length,
      skippedCount: 0,
      rejectedCount: appointmentsRejected,
    },
    finances: {
      sourceCount: rawFinances.length,
      mappedCount: finances.length,
      migratedCount: finances.length,
      skippedCount: 0,
      rejectedCount: financesRejected,
    },
    procedures: {
      sourceCount: rawProcedures.length,
      mappedCount: procedures.length,
      migratedCount: procedures.length,
      skippedCount: 0,
      rejectedCount: proceduresRejected,
    },
    consents: {
      sourceCount: rawConsents.length,
      mappedCount: consents.length,
      migratedCount: consents.length,
      skippedCount: 0,
      rejectedCount: 0,
    },
    conversations: {
      sourceCount: rawConversations.length,
      mappedCount: conversations.length,
      migratedCount: conversations.length,
      skippedCount: 0,
      rejectedCount: 0,
    },
    messages: {
      sourceCount: rawMessages.length,
      mappedCount: messages.length,
      migratedCount: messages.length,
      skippedCount: 0,
      rejectedCount: 0,
    },
    media: {
      sourceCount: rawMedia.length,
      mappedCount: media.length,
      migratedCount: media.length,
      skippedCount: 0,
      rejectedCount: 0,
    },
  };

  const cutoverReady = blockers.length === 0 && financialReconciliation.isReconciled;

  return {
    clients,
    cycles,
    appointments,
    medicalProfiles,
    medicalClearances,
    consents,
    procedures,
    finances,
    conversations,
    messages,
    media,
    counts,
    findings,
    findingCounts,
    financialReconciliation,
    cutoverReadiness: {
      ready: cutoverReady,
      blockers,
    },
  };
}
