import "server-only";
import { db } from "@/db";
import {
  clients,
  treatmentCycles,
  treatmentPackages,
  appointments,
  appointmentCycles,
  clientMedicalProfiles,
  medicalProfileRevisions,
  cycleMedicalClearances,
  consents,
  cycleConsents,
  cycleConsentZones,
  procedureSessions,
  procedurePigments,
  payments,
  paymentTransactions,
  ledgerEntries,
  customOffers,
  offerRevisions,
  offerItems,
  conversations,
  conversationMessages,
  handoffs,
  automationExecutions,
  questionnaireResponses,
  reviews,
  media,
  privacyRequests,
  studioPrivacyRetentionPolicies,
} from "@/db/schema";
import { eq, and, isNull, inArray, or } from "drizzle-orm";
import type { Transaction } from "@/server/commands/ownership";
import type { ClientExportBundle, ClientExportManifest } from "../schemas/privacy.schema";
import { writeAudit } from "@/server/services/audit-log.service";
import crypto from "node:crypto";

/**
 * Remove sensitive system credentials, passwords, and external tokens from records.
 */
function scrubSecrets<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => scrubSecrets(item)) as unknown as T;
  }

  const forbiddenKeys = new Set([
    "password",
    "passwordHash",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "apiKey",
    "oauthToken",
    "privateKey",
  ]);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) continue;
    result[key] = scrubSecrets(value);
  }
  return result as T;
}

/**
 * Aggregates all studio-scoped records for a target client into a deterministic machine-readable bundle.
 */
export async function buildClientExportBundle(
  studioId: string,
  clientId: string,
  executor: typeof db | Transaction = db
): Promise<ClientExportBundle> {
  const [clientRow] = await executor
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.studioId, studioId)))
    .limit(1);

  if (!clientRow) {
    throw new Error("Client not found in studio");
  }

  // 1. Treatment Cycles & Packages
  const clientCycles = await executor
    .select()
    .from(treatmentCycles)
    .where(and(eq(treatmentCycles.clientId, clientId), eq(treatmentCycles.studioId, studioId)));

  const cycleIds = clientCycles.map((c) => c.id);

  const clientPackages = await executor
    .select()
    .from(treatmentPackages)
    .where(and(eq(treatmentPackages.clientId, clientId), eq(treatmentPackages.studioId, studioId)));

  // 2. Appointments & Cycle Links
  const clientAppointments = await executor
    .select()
    .from(appointments)
    .where(and(eq(appointments.clientId, clientId), eq(appointments.studioId, studioId)));

  const clientApptCycles = await executor
    .select()
    .from(appointmentCycles)
    .where(and(eq(appointmentCycles.clientId, clientId), eq(appointmentCycles.studioId, studioId)));

  // 3. Medical Profiles, Revisions & Clearances
  const medicalProfiles = await executor
    .select()
    .from(clientMedicalProfiles)
    .where(eq(clientMedicalProfiles.clientId, clientId));

  const profileRevisions = await executor
    .select()
    .from(medicalProfileRevisions)
    .where(and(eq(medicalProfileRevisions.clientId, clientId), eq(medicalProfileRevisions.studioId, studioId)));

  const clearances =
    cycleIds.length > 0
      ? await executor
          .select()
          .from(cycleMedicalClearances)
          .where(and(eq(cycleMedicalClearances.studioId, studioId), inArray(cycleMedicalClearances.cycleId, cycleIds)))
      : [];

  // 4. Consents & Cycle Consents
  const clientConsents = await executor
    .select()
    .from(consents)
    .where(and(eq(consents.clientId, clientId), eq(consents.studioId, studioId)));

  const clientCycleConsents = await executor
    .select()
    .from(cycleConsents)
    .where(and(eq(cycleConsents.clientId, clientId), eq(cycleConsents.studioId, studioId)));

  const cycleConsentIds = clientCycleConsents.map((c) => c.id);
  const cycleConsentZoneRows =
    cycleConsentIds.length > 0
      ? await executor
          .select()
          .from(cycleConsentZones)
          .where(and(eq(cycleConsentZones.studioId, studioId), inArray(cycleConsentZones.consentId, cycleConsentIds)))
      : [];

  // 5. Procedures, Pigments & Photos
  const clientProcedures = await executor
    .select()
    .from(procedureSessions)
    .where(and(eq(procedureSessions.clientId, clientId), eq(procedureSessions.studioId, studioId)));

  const procedureIds = clientProcedures.map((p) => p.id);
  const pigments =
    procedureIds.length > 0
      ? await executor
          .select()
          .from(procedurePigments)
          .where(inArray(procedurePigments.procedureSessionId, procedureIds))
      : [];

  // 6. Finance: Payments, Transactions, Ledger & Offers
  const clientPayments = await executor
    .select()
    .from(payments)
    .where(and(eq(payments.clientId, clientId), eq(payments.studioId, studioId)));

  const clientTransactions = await executor
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.clientId, clientId), eq(paymentTransactions.studioId, studioId)));

  const clientLedger = await executor
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.clientId, clientId), eq(ledgerEntries.studioId, studioId)));

  const clientOffers = await executor
    .select()
    .from(customOffers)
    .where(and(eq(customOffers.clientId, clientId), eq(customOffers.studioId, studioId)));

  const offerIds = clientOffers.map((o) => o.id);
  const revisions =
    offerIds.length > 0
      ? await executor
          .select()
          .from(offerRevisions)
          .where(and(eq(offerRevisions.studioId, studioId), inArray(offerRevisions.offerId, offerIds)))
      : [];

  const revisionIds = revisions.map((r) => r.id);
  const items =
    revisionIds.length > 0
      ? await executor
          .select()
          .from(offerItems)
          .where(and(eq(offerItems.studioId, studioId), inArray(offerItems.revisionId, revisionIds)))
      : [];

  // 7. Conversations & Messages
  const clientConversations = await executor
    .select()
    .from(conversations)
    .where(and(eq(conversations.clientId, clientId), eq(conversations.studioId, studioId)));

  const convIds = clientConversations.map((c) => c.id);
  const clientMessages =
    convIds.length > 0
      ? await executor
          .select()
          .from(conversationMessages)
          .where(and(eq(conversationMessages.studioId, studioId), inArray(conversationMessages.conversationId, convIds)))
      : [];

  // 8. Handoffs, Automations, Reviews & Questionnaires
  const clientHandoffs = await executor
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.studioId, studioId),
        or(eq(handoffs.clientId, clientId), and(eq(handoffs.entityType, "CLIENT"), eq(handoffs.entityId, clientId)))
      )
    );

  const clientAutomations = await executor
    .select()
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.studioId, studioId),
        eq(automationExecutions.entityType, "CLIENT"),
        eq(automationExecutions.entityId, clientId)
      )
    );

  const clientReviews = await executor
    .select()
    .from(reviews)
    .where(and(eq(reviews.clientId, clientId), eq(reviews.studioId, studioId)));

  const questionnaires = await executor
    .select()
    .from(questionnaireResponses)
    .where(and(eq(questionnaireResponses.clientId, clientId), eq(questionnaireResponses.studioId, studioId)));

  // 9. Media manifest
  const clientMedia = await executor
    .select()
    .from(media)
    .where(and(eq(media.clientId, clientId), eq(media.studioId, studioId), isNull(media.deletedAt)));

  const mediaManifest = clientMedia.map((m) => ({
    mediaId: m.id,
    type: m.type,
    url: m.url,
    caption: m.caption,
    sha256: crypto.createHash("sha256").update(`${m.id}:${m.url}:${m.createdAt.toISOString()}`).digest("hex"),
    createdAt: m.createdAt.toISOString(),
  }));

  const recordCounts = {
    client: 1,
    treatmentCycles: clientCycles.length,
    treatmentPackages: clientPackages.length,
    appointments: clientAppointments.length,
    appointmentCycles: clientApptCycles.length,
    medicalProfiles: medicalProfiles.length,
    medicalProfileRevisions: profileRevisions.length,
    medicalClearances: clearances.length,
    consents: clientConsents.length,
    cycleConsents: clientCycleConsents.length,
    cycleConsentZones: cycleConsentZoneRows.length,
    procedures: clientProcedures.length,
    payments: clientPayments.length,
    ledgerEntries: clientLedger.length,
    offers: clientOffers.length,
    conversations: clientConversations.length,
    messages: clientMessages.length,
    handoffs: clientHandoffs.length,
    automationExecutions: clientAutomations.length,
    reviews: clientReviews.length,
    questionnaires: questionnaires.length,
    mediaManifest: mediaManifest.length,
  };

  const manifest: ClientExportManifest = {
    generatedAt: new Date().toISOString(),
    studioId,
    clientId,
    schemaVersion: "1.0.0",
    recordCounts,
    mediaManifest,
  };

  const bundle: ClientExportBundle = {
    manifest,
    client: scrubSecrets(clientRow) as Record<string, unknown>,
    treatmentCycles: scrubSecrets(clientCycles),
    treatmentPackages: scrubSecrets(clientPackages),
    appointments: scrubSecrets(clientAppointments),
    medicalProfiles: scrubSecrets(medicalProfiles),
    medicalProfileRevisions: scrubSecrets(profileRevisions),
    medicalClearances: scrubSecrets(clearances),
    consents: scrubSecrets(clientConsents),
    cycleConsents: scrubSecrets(clientCycleConsents),
    procedures: scrubSecrets({
      sessions: clientProcedures,
      pigments,
    }) as unknown as unknown[],
    payments: scrubSecrets({
      payments: clientPayments,
      transactions: clientTransactions,
    }) as unknown as unknown[],
    ledgerEntries: scrubSecrets(clientLedger),
    offers: scrubSecrets({
      offers: clientOffers,
      revisions,
      items,
    }) as unknown as unknown[],
    conversations: scrubSecrets(clientConversations),
    messages: scrubSecrets(clientMessages),
    handoffs: scrubSecrets(clientHandoffs),
    automationExecutions: scrubSecrets(clientAutomations),
    reviews: scrubSecrets(clientReviews),
    questionnaires: scrubSecrets(questionnaires),
  };

  return bundle;
}

/**
 * Executes a requested or approved privacy export request, generates the JSON bundle,
 * binds a media artifact with expiration, and updates the request status to COMPLETED.
 */
export async function executePrivacyExport(
  requestId: string,
  studioId: string,
  actorId: string
): Promise<{
  requestId: string;
  bundle: ClientExportBundle;
  exportExpiresAt: Date;
  exportArtifactId: string;
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

    if (request.status === "COMPLETED" && request.exportArtifactId) {
      // Already completed - idempotent return
      const bundle = await buildClientExportBundle(studioId, request.clientId, tx);
      return {
        requestId,
        bundle,
        exportExpiresAt: request.exportExpiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        exportArtifactId: request.exportArtifactId,
      };
    }

    if (request.status === "CANCELLED" || request.status === "FAILED") {
      throw new Error(`Cannot export request in status ${request.status}`);
    }

    // Update status to RUNNING
    await tx
      .update(privacyRequests)
      .set({
        status: "RUNNING",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(privacyRequests.id, requestId));

    try {
      const bundle = await buildClientExportBundle(studioId, request.clientId, tx);

      // Retrieve studio retention policy for privacy export expiration
      const [policy] = await tx
        .select()
        .from(studioPrivacyRetentionPolicies)
        .where(eq(studioPrivacyRetentionPolicies.studioId, studioId))
        .limit(1);

      const retentionDays = policy?.privacyExportRetentionDays ?? 30;
      const exportExpiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

      // Create a media artifact row representing the export bundle
      const [artifact] = await tx
        .insert(media)
        .values({
          studioId,
          clientId: request.clientId,
          type: "document",
          url: `/api/privacy/export/${requestId}/download`,
          publicId: `export-${requestId}`,
          caption: `Privacy DSAR Data Export (${request.clientId})`,
          createdById: actorId,
        })
        .returning();

      // Mark privacy request as COMPLETED
      await tx
        .update(privacyRequests)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          exportArtifactId: artifact.id,
          exportExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId));

      await writeAudit(tx, {
        studioId,
        userId: actorId,
        action: "privacy_export_generated",
        entityType: "privacy_request",
        entityId: requestId,
        before: { status: request.status },
        after: { status: "COMPLETED", exportArtifactId: artifact.id, exportExpiresAt: exportExpiresAt.toISOString() },
        reason: "command:privacy_export_generated",
        metadata: { clientId: request.clientId, recordCounts: bundle.manifest.recordCounts },
      });

      return {
        requestId,
        bundle,
        exportExpiresAt,
        exportArtifactId: artifact.id,
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Export generation failed";
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
