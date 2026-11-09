import { CYCLE_STAGES, CYCLE_KINDS, CYCLE_ZONES } from "@/features/treatment-cycles/schemas/cycle.schema";
export type CycleStage = (typeof CYCLE_STAGES)[number];
export type CycleKind = (typeof CYCLE_KINDS)[number];
export type CycleZone = (typeof CYCLE_ZONES)[number];

export type MigrationSeverity = "BLOCKER" | "ERROR" | "WARNING" | "INFO";

export interface MigrationFinding {
  code: string;
  severity: MigrationSeverity;
  entityType: string;
  sourceId?: string;
  message: string;
  details?: Record<string, unknown>;
  rawSnippet?: string;
}

export interface DurableIdMapping {
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  targetEntityId: string;
  createdAt: string;
}

export type MappingConfidence = "HIGH" | "AMBIGUOUS" | "NONE";

export interface CycleStageMappingRule {
  legacyValue: string;
  canonicalStage: CycleStage | null;
  confidence: MappingConfidence;
  reason: string;
}

export interface StaffMappingRule {
  legacyStaffIdOrName: string;
  targetMasterId?: string;
  targetUserId?: string;
  status: "MAPPED" | "MANUAL_REVIEW" | "UNMAPPED";
  notes?: string;
}

export interface ServiceMappingRule {
  legacyServiceNameOrCode: string;
  targetServiceId?: string;
  catalogCode?: string;
  status: "MAPPED" | "MANUAL_REVIEW" | "UNMAPPED";
  notes?: string;
}

export interface MigrationConfiguration {
  sourceSystem: string;
  defaultTimezone: string; // e.g. "Europe/Rome"
  studioId: string;
  actorUserId: string;
  staffMappings: Record<string, StaffMappingRule>;
  serviceMappings: Record<string, ServiceMappingRule>;
  currency: string; // e.g. "EUR"
  dryRun: boolean;
  confirmProduction?: boolean;
}

// Raw legacy input shapes
export interface LegacyClientInput {
  id: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  birthDate?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  referralSource?: string | null;
  legacyStatus?: string | null;
  createdAt?: string | null;
  isAnonymized?: boolean | null;
  deletedAt?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface LegacyStaffInput {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  active?: boolean;
}

export interface LegacyServiceInput {
  id: string;
  name: string;
  catalogCode?: string | null;
  durationMinutes?: number | null;
  priceCents?: number | null;
  zone?: string | null;
}

export interface LegacyAppointmentInput {
  id: string;
  clientId: string;
  staffId?: string | null;
  staffName?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  startAt: string;
  endAt?: string | null;
  status: string; // e.g. "confirmed", "completed", "cancelled", "no_show"
  timezone?: string | null;
  notes?: string | null;
  googleEventId?: string | null;
  createdAt?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface LegacyCycleInput {
  id: string;
  clientId: string;
  zone: string; // e.g. "brows", "eyes", "lips"
  kind?: string | null; // e.g. "pmu", "refresh", "remover"
  legacyStatus?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  packageId?: string | null;
  originCycleId?: string | null;
  startDate?: string | null;
  notes?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface LegacyMedicalProfileInput {
  id?: string;
  clientId: string;
  allergies?: string | null;
  chronicConditions?: string | null;
  medications?: string | null;
  pregnantOrLactating?: boolean | null;
  keloidHistory?: boolean | null;
  notes?: string | null;
  updatedAt?: string | null;
  sourceProven: boolean; // Must be true to import factual medical profile
}

export interface LegacyMedicalClearanceInput {
  id?: string;
  clientId: string;
  cycleId?: string | null;
  decision: "CLEARED" | "CONSULTATION_REQUIRED" | "NOT_CLEARED" | string;
  reviewerStaffId?: string | null;
  reviewerName?: string | null;
  decidedAt?: string | null;
  notes?: string | null;
  hasExplicitEvidence: boolean; // Must be true, "green" or "okay" without evidence is rejected
}

export interface LegacyConsentInput {
  id: string;
  clientId: string;
  cycleId?: string | null;
  consentType?: string | null;
  signedAt?: string | null;
  signatoryName?: string | null;
  signatoryPhone?: string | null;
  documentSha256?: string | null;
  documentPath?: string | null;
  hasSignedArtifact: boolean; // Evidentiary: must have real signed media/artifact
  legacyBooleanOnly?: boolean; // If true, stored only as reference, not SIGNED cycle consent
  notes?: string | null;
}

export interface LegacyProcedureInput {
  id: string;
  appointmentId?: string | null;
  clientId: string;
  cycleId?: string | null;
  staffId?: string | null;
  zone: string;
  procedureArea?: string | null;
  sessionType?: string | null;
  status: string; // "completed", "cancelled", "no_show", "draft"
  executedAt: string;
  notes?: string | null;
  pigmentMix?: string | null;
  anesthesia?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface LegacyFinanceInput {
  id: string;
  clientId: string;
  appointmentId?: string | null;
  cycleId?: string | null;
  type: "charge" | "payment" | "refund" | "adjustment" | "opening_balance";
  amountMinor: number; // in minor units / cents
  currency: string;
  date: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  isOpeningBalanceAdjustment?: boolean;
}

export interface LegacyConversationInput {
  id: string;
  clientId: string;
  channel: "whatsapp" | "telegram" | "instagram" | "sms" | string;
  externalThreadId?: string | null;
  createdAt: string;
}

export interface LegacyMessageInput {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  sender?: string | null;
  providerMessageId?: string | null;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface LegacyMediaInput {
  id: string;
  clientId: string;
  appointmentId?: string | null;
  procedureId?: string | null;
  consentId?: string | null;
  type: "consent" | "before" | "after" | "general" | string;
  filePath: string;
  url?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  createdAt?: string | null;
  fileExists: boolean;
}

export interface LegacyPackageInput {
  id: string;
  clientId: string;
  name: string;
  packageCode: string;
  zones: string[];
  createdAt?: string | null;
}

export interface LegacySourceDataset {
  sourceSystem: string;
  extractedAt: string;
  clients?: LegacyClientInput[];
  staff?: LegacyStaffInput[];
  services?: LegacyServiceInput[];
  appointments?: LegacyAppointmentInput[];
  cycles?: LegacyCycleInput[];
  medicalProfiles?: LegacyMedicalProfileInput[];
  medicalClearances?: LegacyMedicalClearanceInput[];
  consents?: LegacyConsentInput[];
  procedures?: LegacyProcedureInput[];
  finances?: LegacyFinanceInput[];
  conversations?: LegacyConversationInput[];
  messages?: LegacyMessageInput[];
  media?: LegacyMediaInput[];
  packages?: LegacyPackageInput[];
}

export interface ClientFinancialReconciliation {
  clientId: string;
  clientName: string;
  legacyExpectedBalanceMinor: number;
  importedLedgerBalanceMinor: number;
  differenceMinor: number;
  currency: string;
  status: "BALANCED" | "MISMATCHED";
}

export interface FinancialReconciliationReport {
  studioTotalLegacyExpectedMinor: number;
  studioTotalImportedLedgerMinor: number;
  studioDifferenceMinor: number;
  currency: string;
  clientCount: number;
  mismatchedClients: ClientFinancialReconciliation[];
  isReconciled: boolean;
}

export interface EntityMigrationCounts {
  sourceCount: number;
  mappedCount: number;
  migratedCount: number;
  skippedCount: number;
  rejectedCount: number;
}

export interface MigrationRunSummary {
  runId: string;
  sourceSystem: string;
  studioId: string;
  mode: "DRY_RUN" | "APPLY";
  startedAt: string;
  completedAt: string;
  inputChecksum: string;
  status: "DRY_RUN_PASSED" | "DRY_RUN_BLOCKED" | "APPLIED_SUCCESSFULLY" | "APPLY_FAILED";
  counts: Record<string, EntityMigrationCounts>;
  findings: MigrationFinding[];
  findingCounts: Record<MigrationSeverity, number>;
  financialReconciliation: FinancialReconciliationReport;
  cutoverReadiness: {
    ready: boolean;
    blockers: string[];
  };
}
