import type {
  LegacyMedicalProfileInput,
  LegacyMedicalClearanceInput,
  LegacyConsentInput,
  MigrationFinding,
} from "../types";

export interface NormalizedMedicalProfileRecord {
  clientId: string;
  allergies: string | null;
  chronicConditions: string | null;
  medications: string | null;
  pregnantOrLactating: boolean;
  keloidHistory: boolean;
  notes: string | null;
  updatedAt: Date;
}

export interface NormalizedMedicalClearanceRecord {
  clientId: string;
  cycleId: string | null;
  decision: "CLEARED" | "CONSULTATION_REQUIRED" | "NOT_CLEARED";
  reviewerStaffId: string;
  reviewerName: string;
  decidedAt: Date;
  notes: string | null;
}

export interface NormalizedConsentRecord {
  sourceId: string;
  clientId: string;
  cycleId: string | null;
  consentType: string;
  signedAt: Date;
  signatoryName: string | null;
  signatoryPhone: string | null;
  documentSha256: string | null;
  documentPath: string | null;
  isCanonicalSignedEvidence: boolean;
  isLegacyReferenceOnly: boolean;
  notes: string | null;
}

export function normalizeLegacyMedicalProfile(
  input: LegacyMedicalProfileInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedMedicalProfileRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "MEDICAL_PROFILE_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "medical_profile",
      sourceId: input.clientId,
      message: `Medical profile references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // Medical profile is HIGH RISK: Only import if source has proven structured answers
  if (!input.sourceProven) {
    findings.push({
      code: "MEDICAL_PROFILE_UNPROVEN_SOURCE_REJECTED",
      severity: "WARNING",
      entityType: "medical_profile",
      sourceId: input.clientId,
      message: `Medical profile for client ${input.clientId} skipped because source evidence is unstructured or unproven. Clinical fields must not be inferred from arbitrary text.`,
    });
    return { normalized: null, findings };
  }

  let updatedAt = new Date();
  if (input.updatedAt) {
    const d = new Date(input.updatedAt);
    if (!isNaN(d.getTime())) updatedAt = d;
  }

  const normalized: NormalizedMedicalProfileRecord = {
    clientId: input.clientId,
    allergies: input.allergies ? input.allergies.trim() : null,
    chronicConditions: input.chronicConditions ? input.chronicConditions.trim() : null,
    medications: input.medications ? input.medications.trim() : null,
    pregnantOrLactating: Boolean(input.pregnantOrLactating),
    keloidHistory: Boolean(input.keloidHistory),
    notes: input.notes || null,
    updatedAt,
  };

  return { normalized, findings };
}

export function normalizeLegacyMedicalClearance(
  input: LegacyMedicalClearanceInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
    staffSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedMedicalClearanceRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "MEDICAL_CLEARANCE_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "medical_clearance",
      sourceId: input.clientId,
      message: `Medical clearance references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  // NEVER infer CLEARED without explicit human reviewer proof and trustworthy semantics
  const rawDecision = (input.decision || "").trim().toUpperCase();
  let decision: NormalizedMedicalClearanceRecord["decision"] | null = null;

  if (rawDecision === "CLEARED" || rawDecision === "APPROVED") {
    decision = "CLEARED";
  } else if (rawDecision === "CONSULTATION_REQUIRED" || rawDecision === "CONSULT_REQUIRED") {
    decision = "CONSULTATION_REQUIRED";
  } else if (rawDecision === "NOT_CLEARED" || rawDecision === "REJECTED") {
    decision = "NOT_CLEARED";
  } else if (rawDecision === "REVIEW_REQUIRED") {
    findings.push({
      code: "MEDICAL_CLEARANCE_REVIEW_REQUIRED_NOT_A_DECISION",
      severity: "WARNING",
      entityType: "medical_clearance",
      sourceId: input.clientId,
      message: `REVIEW_REQUIRED is a derived state, not a human clearance decision; skipped manual clearance creation.`,
    });
    return { normalized: null, findings };
  } else {
    findings.push({
      code: "MEDICAL_CLEARANCE_AMBIGUOUS_DECISION_MANUAL_REVIEW",
      severity: "WARNING",
      entityType: "medical_clearance",
      sourceId: input.clientId,
      message: `Ambiguous clearance value '${input.decision}' (e.g. 'green', 'okay', 'done') lacks trustworthy clinical semantics; requires manual review.`,
    });
    return { normalized: null, findings };
  }

  // Reviewer evidence check
  if (!input.hasExplicitEvidence || (!input.reviewerStaffId && !input.reviewerName)) {
    findings.push({
      code: "MEDICAL_CLEARANCE_MISSING_REVIEWER_EVIDENCE",
      severity: "ERROR",
      entityType: "medical_clearance",
      sourceId: input.clientId,
      message: `Medical clearance for client ${input.clientId} lacks explicit reviewer evidence. Will not fabricate reviewer identity.`,
    });
    return { normalized: null, findings };
  }

  let decidedAt = new Date();
  if (input.decidedAt) {
    const d = new Date(input.decidedAt);
    if (!isNaN(d.getTime())) decidedAt = d;
  }

  const normalized: NormalizedMedicalClearanceRecord = {
    clientId: input.clientId,
    cycleId: input.cycleId || null,
    decision,
    reviewerStaffId: input.reviewerStaffId || "legacy_reviewer",
    reviewerName: input.reviewerName || "Legacy Reviewer",
    decidedAt,
    notes: input.notes || null,
  };

  return { normalized, findings };
}

export function normalizeLegacyConsent(
  input: LegacyConsentInput,
  options: {
    clientSourceIdToTargetId: Map<string, string>;
  }
): {
  normalized: NormalizedConsentRecord | null;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  if (!options.clientSourceIdToTargetId.has(input.clientId)) {
    findings.push({
      code: "CONSENT_UNRESOLVED_CLIENT",
      severity: "ERROR",
      entityType: "consent",
      sourceId: input.id,
      message: `Consent ${input.id} references unmapped client ${input.clientId}`,
    });
    return { normalized: null, findings };
  }

  let signedAt = new Date();
  if (input.signedAt) {
    const d = new Date(input.signedAt);
    if (!isNaN(d.getTime())) signedAt = d;
  }

  // If source contains only a boolean flag `consent=true` without document or signature artifact:
  // preserve as legacy reference only, DO NOT create canonical SIGNED cycle consent!
  if (input.legacyBooleanOnly || !input.hasSignedArtifact || !input.documentSha256) {
    findings.push({
      code: "CONSENT_LEGACY_BOOLEAN_REFERENCE_ONLY",
      severity: "INFO",
      entityType: "consent",
      sourceId: input.id,
      message: `Consent ${input.id} for client ${input.clientId} has no signed document artifact; stored as legacy reference only. A fresh canonical consent will be required for upcoming procedures.`,
    });

    const referenceOnly: NormalizedConsentRecord = {
      sourceId: input.id,
      clientId: input.clientId,
      cycleId: input.cycleId || null,
      consentType: input.consentType || "procedure_consent",
      signedAt,
      signatoryName: input.signatoryName || null,
      signatoryPhone: input.signatoryPhone || null,
      documentSha256: null,
      documentPath: null,
      isCanonicalSignedEvidence: false,
      isLegacyReferenceOnly: true,
      notes: input.notes || "Migrated as legacy reference flag (no signed artifact)",
    };

    return { normalized: referenceOnly, findings };
  }

  const canonicalRecord: NormalizedConsentRecord = {
    sourceId: input.id,
    clientId: input.clientId,
    cycleId: input.cycleId || null,
    consentType: input.consentType || "procedure_consent",
    signedAt,
    signatoryName: input.signatoryName || null,
    signatoryPhone: input.signatoryPhone || null,
    documentSha256: input.documentSha256,
    documentPath: input.documentPath || null,
    isCanonicalSignedEvidence: true,
    isLegacyReferenceOnly: false,
    notes: input.notes || null,
  };

  return { normalized: canonicalRecord, findings };
}
