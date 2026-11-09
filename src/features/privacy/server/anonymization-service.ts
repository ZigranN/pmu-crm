import "server-only";
import { db } from "@/db";
import {
  clients,
  clientMedicalProfiles,
  appointments,
  privacyRequests,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";

export interface AnonymizeClientResult {
  clientId: string;
  anonymizedAt: Date;
  updatedFields: string[];
}

/**
 * Deterministically replaces direct identifying attributes with non-identifying placeholders
 * while preserving primary key (clientId), append-only ledger entries, signed consent proofs,
 * and clinical procedure histories intact.
 */
export async function anonymizeClient(
  studioId: string,
  clientId: string,
  actorId: string,
  reason: string,
  tx: Transaction
): Promise<AnonymizeClientResult> {
  const [clientRow] = await tx
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId)))
    .for("update")
    .limit(1);

  if (!clientRow) {
    throw new Error("Client not found in studio");
  }

  // Idempotency check: if client is already anonymized, return cleanly
  if (
    clientRow.firstName === "Anonymized" &&
    clientRow.fullName === "Anonymized Client" &&
    clientRow.phone === "+000000000000" &&
    clientRow.email === null &&
    clientRow.whatsapp === null
  ) {
    return {
      clientId,
      anonymizedAt: clientRow.updatedAt,
      updatedFields: [],
    };
  }

  const updatedFields = [
    "firstName",
    "lastName",
    "fullName",
    "phone",
    "whatsapp",
    "email",
    "instagram",
    "birthDate",
    "notes",
    "tags",
    "referredByName",
    "campaignTag",
    "serviceTag",
  ];

  // 1. Sanitize clients table direct PII fields
  // Postgres generated columns (phoneKey, emailKey, nameKey, instagramKey, whatsappKey)
  // will automatically recalculate.
  await tx
    .update(clients)
    .set({
      firstName: "Anonymized",
      lastName: "Client",
      fullName: "Anonymized Client",
      phone: "+000000000000",
      whatsapp: null,
      email: null,
      instagram: null,
      birthDate: null,
      notes: null,
      tags: null,
      referredByName: null,
      campaignTag: null,
      serviceTag: null,
      interest: null,
      treatmentZone: null,
      updatedAt: new Date(),
    })
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId)));

  // 2. Sanitize client medical profile free-text fields while keeping clinical flags
  await tx
    .update(clientMedicalProfiles)
    .set({
      allergies: null,
      contraindications: null,
      medications: null,
      previousPMUNotes: null,
      skinType: null,
      pregnancyStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(clientMedicalProfiles.clientId, clientId));

  // 3. Sanitize appointments clientSnapshot name and phone to prevent PII leakage in calendar / booking displays
  await tx
    .update(appointments)
    .set({
      clientSnapshot: sql`jsonb_set(jsonb_set(coalesce(client_snapshot, '{}'::jsonb), '{name}', '"Anonymized Client"'), '{phone}', '"+000000000000"')`,
      updatedAt: new Date(),
    })
    .where(and(eq(appointments.clientId, clientId), eq(appointments.studioId, studioId)));

  // Evidence Preservation Invariants:
  // - ledgerEntries: strictly append-only, untouched.
  // - consents / cycleConsents: hashes and signed records preserved untouched.
  // - procedureSessions: protocols, clinical outcomes, and session integrity preserved.
  // - auditLogs: historical audit integrity untouched.

  return {
    clientId,
    anonymizedAt: new Date(),
    updatedFields,
  };
}

/**
 * Executes a requested or approved privacy anonymization request, updates the client record,
 * and sets the request status to COMPLETED.
 */
export async function executePrivacyAnonymize(
  requestId: string,
  studioId: string,
  actorId: string,
  reason?: string
): Promise<{
  requestId: string;
  clientId: string;
  anonymizedAt: Date;
}> {
  return await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.id, requestId), eq(privacyRequests.studioId, studioId)))
      .for("update")
      .limit(1);

    if (!request) {
      throw new Error("Privacy request not found");
    }

    if (request.status === "COMPLETED") {
      return {
        requestId,
        clientId: request.clientId,
        anonymizedAt: request.completedAt || new Date(),
      };
    }

    if (request.status === "CANCELLED" || request.status === "FAILED") {
      throw new Error(`Cannot anonymize request in status ${request.status}`);
    }

    // Set status to RUNNING
    await tx
      .update(privacyRequests)
      .set({
        status: "RUNNING",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(privacyRequests.id, requestId));

    await writeAudit(tx, {
      studioId,
      userId: actorId,
      action: "privacy_anonymization_started",
      entityType: "privacy_request",
      entityId: requestId,
      before: { status: request.status },
      after: { status: "RUNNING" },
      reason: reason || "command:privacy_anonymization_started",
      metadata: { clientId: request.clientId },
    });

    try {
      const anonResult = await anonymizeClient(
        studioId,
        request.clientId,
        actorId,
        reason || "DSAR Anonymization",
        tx
      );

      // Mark privacy request as COMPLETED
      await tx
        .update(privacyRequests)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId));

      await writeAudit(tx, {
        studioId,
        userId: actorId,
        action: "privacy_anonymization_completed",
        entityType: "privacy_request",
        entityId: requestId,
        before: { status: "RUNNING" },
        after: { status: "COMPLETED" },
        reason: reason || "command:privacy_anonymization_completed",
        metadata: { clientId: request.clientId, updatedFields: anonResult.updatedFields },
      });

      return {
        requestId,
        clientId: request.clientId,
        anonymizedAt: anonResult.anonymizedAt,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Anonymization failed";
      await tx
        .update(privacyRequests)
        .set({
          status: "FAILED",
          failedAt: new Date(),
          failureReason: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId));
      throw err;
    }
  });
}
