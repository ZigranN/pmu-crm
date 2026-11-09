import { canonicalPhone } from "@/lib/phone";
import { canonicalEmail, canonicalInstagram, canonicalName, similarName } from "@/features/clients/contacts";
import type { LegacyClientInput, MigrationFinding } from "../types";

export interface NormalizedClientRecord {
  sourceId: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  instagram: string | null;
  birthDate: string | null;
  notes: string | null;
  tags: string[];
  referralSource: string | null;
  legacyStatus: string | null;
  isAnonymized: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  rawPayload: Record<string, unknown>;
  duplicateMatchTargetId?: string;
  duplicateConfidence?: "EXACT" | "POSSIBLE_MANUAL_REVIEW";
}

export function normalizeLegacyClient(
  input: LegacyClientInput,
  existingClients: NormalizedClientRecord[] = []
): {
  normalized: NormalizedClientRecord;
  findings: MigrationFinding[];
} {
  const findings: MigrationFinding[] = [];

  const firstName = input.firstName ? input.firstName.trim() : "";
  const lastName = input.lastName ? input.lastName.trim() : null;

  if (!firstName) {
    findings.push({
      code: "CLIENT_MISSING_FIRST_NAME",
      severity: "ERROR",
      entityType: "client",
      sourceId: input.id,
      message: `Client ${input.id} is missing a required first name`,
    });
  }

  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  // Phone normalization
  const phone = input.phone ? canonicalPhone(input.phone) || input.phone.trim() : null;
  const whatsapp = input.whatsapp ? canonicalPhone(input.whatsapp) || input.whatsapp.trim() : phone;
  const email = input.email ? canonicalEmail(input.email) || input.email.trim().toLowerCase() : null;
  const instagram = input.instagram ? canonicalInstagram(input.instagram) || input.instagram.trim() : null;

  const isAnonymized = Boolean(input.isAnonymized || (input.notes && input.notes.toLowerCase().includes("anonymized")));
  const deletedAt = isAnonymized ? (input.deletedAt ? new Date(input.deletedAt) : new Date()) : null;

  let createdAt = new Date();
  if (input.createdAt) {
    const d = new Date(input.createdAt);
    if (!isNaN(d.getTime())) {
      createdAt = d;
    }
  }

  const normalized: NormalizedClientRecord = {
    sourceId: input.id,
    firstName: isAnonymized ? "Anonymized" : firstName,
    lastName: isAnonymized ? "Client" : lastName,
    fullName: isAnonymized ? "Anonymized Client" : fullName,
    phone: isAnonymized ? null : phone,
    email: isAnonymized ? null : email,
    whatsapp: isAnonymized ? null : whatsapp,
    instagram: isAnonymized ? null : instagram,
    birthDate: isAnonymized ? null : (input.birthDate || null),
    notes: input.notes || null,
    tags: Array.isArray(input.tags) ? input.tags : [],
    referralSource: input.referralSource || null,
    legacyStatus: input.legacyStatus || null,
    isAnonymized,
    deletedAt,
    createdAt,
    rawPayload: input.rawPayload || {},
  };

  if (input.legacyStatus) {
    findings.push({
      code: "CLIENT_LEGACY_STATUS_NOT_WORKFLOW_TRUTH",
      severity: "INFO",
      entityType: "client",
      sourceId: input.id,
      message: `Preserved legacy status '${input.legacyStatus}' in migration metadata. Canonical workflow truth is governed strictly by TreatmentCycle.stage.`,
    });
  }

  // Deduplication check against previously processed clients in the batch
  if (!isAnonymized) {
    for (const existing of existingClients) {
      if (existing.isAnonymized) continue;

      // 1. High-confidence contact match
      const phoneMatch = phone && existing.phone && (phone === existing.phone || phone === existing.whatsapp);
      const emailMatch = email && existing.email && email === existing.email;

      if (phoneMatch || emailMatch) {
        normalized.duplicateMatchTargetId = existing.sourceId;
        normalized.duplicateConfidence = "EXACT";
        findings.push({
          code: "CLIENT_EXACT_CONTACT_DUPLICATE",
          severity: "WARNING",
          entityType: "client",
          sourceId: input.id,
          message: `High-confidence duplicate detected with existing client ${existing.sourceId} (${phoneMatch ? "phone" : "email"} match: ${phoneMatch ? phone : email})`,
          details: { existingSourceId: existing.sourceId, matchType: phoneMatch ? "phone" : "email" },
        });
        break;
      }

      // 2. Name-only similarity check (DO NOT auto-merge)
      if (fullName && existing.fullName) {
        const name1 = canonicalName(fullName);
        const name2 = canonicalName(existing.fullName);
        if (similarName(name1, name2) || (name1 === name2 && name1.length >= 3)) {
          findings.push({
            code: "CLIENT_NAME_ONLY_MATCH_MANUAL_REVIEW",
            severity: "WARNING",
            entityType: "client",
            sourceId: input.id,
            message: `Possible duplicate by name with client ${existing.sourceId} ('${fullName}' vs '${existing.fullName}'). Name-only match must NOT auto-merge; flagged for manual review.`,
            details: { existingSourceId: existing.sourceId, matchedName: existing.fullName },
          });
        }
      }
    }
  }

  return { normalized, findings };
}
