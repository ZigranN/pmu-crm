import { randomUUID, createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type {
  LegacySourceDataset,
  MigrationConfiguration,
  MigrationRunSummary,
  DurableIdMapping,
} from "../types";
import { computeSourceChecksum } from "../staging/parser";
import { validateAndStageDataset } from "../validation/validator";
import { isPotentialProductionTarget } from "../../../../scripts/restore-postgres.mjs";
import * as schema from "@/db/schema";
import { writeAudit } from "@/server/services/audit-log.service";

export function generateDeterministicUuid(
  sourceSystem: string,
  entityType: string,
  sourceId: string
): string {
  const hash = createHash("sha256")
    .update(`${sourceSystem}:${entityType}:${sourceId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class MigrationEngine {
  private idMappings: Map<string, DurableIdMapping> = new Map();

  private getMappingKey(sourceSystem: string, entityType: string, sourceId: string): string {
    return `${sourceSystem}:${entityType}:${sourceId}`;
  }

  public getOrCreateTargetId(
    sourceSystem: string,
    entityType: string,
    sourceId: string,
    fallbackId?: string
  ): string {
    const key = this.getMappingKey(sourceSystem, entityType, sourceId);
    const existing = this.idMappings.get(key);
    if (existing) {
      return existing.targetEntityId;
    }
    const targetEntityId = fallbackId || generateDeterministicUuid(sourceSystem, entityType, sourceId);
    this.idMappings.set(key, {
      sourceSystem,
      sourceEntityType: entityType,
      sourceEntityId: sourceId,
      targetEntityId,
      createdAt: new Date().toISOString(),
    });
    return targetEntityId;
  }

  public getMapping(sourceSystem: string, entityType: string, sourceId: string): string | undefined {
    return this.idMappings.get(this.getMappingKey(sourceSystem, entityType, sourceId))?.targetEntityId;
  }

  /**
   * DRY RUN MODE:
   * Parses, stages, validates, maps, and reconciles legacy data without writing ANY database records.
   */
  public async dryRun(
    dataset: LegacySourceDataset,
    config: MigrationConfiguration
  ): Promise<MigrationRunSummary> {
    const startedAt = new Date().toISOString();
    const runId = `migration_dryrun_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const inputChecksum = computeSourceChecksum(dataset);

    const staged = validateAndStageDataset(dataset, config);
    const completedAt = new Date().toISOString();

    const status = staged.cutoverReadiness.ready ? "DRY_RUN_PASSED" : "DRY_RUN_BLOCKED";

    return {
      runId,
      sourceSystem: dataset.sourceSystem || config.sourceSystem,
      studioId: config.studioId,
      mode: "DRY_RUN",
      startedAt,
      completedAt,
      inputChecksum,
      status,
      counts: staged.counts,
      findings: staged.findings,
      findingCounts: staged.findingCounts,
      financialReconciliation: staged.financialReconciliation,
      cutoverReadiness: staged.cutoverReadiness,
    };
  }

  /**
   * APPLY MODE:
   * Executes migration with production target guards, transaction boundaries,
   * deterministic ID mapping, idempotency, and audit logging.
   */
  public async apply(
    dataset: LegacySourceDataset,
    config: MigrationConfiguration,
    db: any,
    targetDbUrl?: string
  ): Promise<MigrationRunSummary> {
    const startedAt = new Date().toISOString();
    const runId = `migration_apply_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const inputChecksum = computeSourceChecksum(dataset);

    // Production safety guardrail
    if (targetDbUrl && isPotentialProductionTarget(targetDbUrl) && !config.confirmProduction) {
      throw new Error(
        "PRODUCTION SAFETY REFUSAL: Target database URL appears to be production. " +
        "You must explicitly provide --confirm-production to apply migrations to production targets."
      );
    }

    // Step 1: Validate and stage input
    const staged = validateAndStageDataset(dataset, config);

    // If blockers exist, refuse apply
    if (staged.cutoverReadiness.blockers.length > 0 || !staged.financialReconciliation.isReconciled) {
      const completedAt = new Date().toISOString();
      return {
        runId,
        sourceSystem: dataset.sourceSystem || config.sourceSystem,
        studioId: config.studioId,
        mode: "APPLY",
        startedAt,
        completedAt,
        inputChecksum,
        status: "APPLY_FAILED",
        counts: staged.counts,
        findings: staged.findings,
        findingCounts: staged.findingCounts,
        financialReconciliation: staged.financialReconciliation,
        cutoverReadiness: staged.cutoverReadiness,
      };
    }

    const sourceSystem = dataset.sourceSystem || config.sourceSystem;
    const studioId = config.studioId;
    const actorUserId = config.actorUserId;

    // Step 2: Database application inside transactions
    await db.transaction(async (tx: any) => {
      // 1. Insert / Sync Clients
      for (const client of staged.clients) {
        const targetId = this.getOrCreateTargetId(sourceSystem, "client", client.sourceId);

        // Check idempotency: does client already exist?
        const [existing] = await tx
          .select({ id: schema.clients.id })
          .from(schema.clients)
          .where(and(eq(schema.clients.id, targetId), eq(schema.clients.studioId, studioId)))
          .limit(1);

        if (!existing) {
          await tx.insert(schema.clients).values({
            id: targetId,
            studioId,
            firstName: client.firstName,
            lastName: client.lastName,
            fullName: client.fullName,
            phone: client.phone || "",
            email: client.email,
            whatsapp: client.whatsapp,
            instagram: client.instagram,
            birthDate: client.birthDate ? new Date(client.birthDate) : null,
            notes: client.notes,
            tags: client.tags.length > 0 ? client.tags.join(",") : null,
            referralSource: client.referralSource,
            clientStatus: "new_lead", // Canonical schema field (workflow truth governed by TreatmentCycles)
            deletedAt: client.deletedAt,
            createdAt: client.createdAt,
            updatedAt: new Date(),
          });

          await writeAudit(tx, {
            studioId,
            userId: actorUserId,
            action: "client_created",
            entityType: "client",
            entityId: targetId,
            before: null,
            after: { sourceId: client.sourceId, fullName: client.fullName },
            reason: `Data migration run ${runId}`,
          });
        }
      }

      // 2. Insert / Sync Treatment Packages & Cycles
      if (dataset.packages) {
        for (const pkg of dataset.packages) {
          const targetPkgId = this.getOrCreateTargetId(sourceSystem, "package", pkg.id);
          const targetClientId = this.getOrCreateTargetId(sourceSystem, "client", pkg.clientId);

          const [existingPkg] = await tx
            .select({ id: schema.treatmentPackages.id })
            .from(schema.treatmentPackages)
            .where(eq(schema.treatmentPackages.id, targetPkgId))
            .limit(1);

          if (!existingPkg) {
            await tx.insert(schema.treatmentPackages).values({
              id: targetPkgId,
              studioId,
              clientId: targetClientId,
              kind: "total_face",
              status: "active",
              version: 1,
              createdById: actorUserId,
              createdAt: pkg.createdAt ? new Date(pkg.createdAt) : new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }

      for (const cycle of staged.cycles) {
        const targetCycleId = this.getOrCreateTargetId(sourceSystem, "cycle", cycle.sourceId);
        const targetClientId = this.getOrCreateTargetId(sourceSystem, "client", cycle.clientId);
        const masterId = cycle.assignedMasterId ? (config.staffMappings[cycle.assignedMasterId]?.targetMasterId || null) : null;
        const serviceId = cycle.serviceId ? (config.serviceMappings[cycle.serviceId]?.targetServiceId || null) : null;

        const [existingCycle] = await tx
          .select({ id: schema.treatmentCycles.id })
          .from(schema.treatmentCycles)
          .where(eq(schema.treatmentCycles.id, targetCycleId))
          .limit(1);

        if (!existingCycle) {
          await tx.insert(schema.treatmentCycles).values({
            id: targetCycleId,
            studioId,
            clientId: targetClientId,
            zoneCode: cycle.zone,
            kind: cycle.kind,
            stage: cycle.stage,
            assignedMasterId: masterId,
            serviceId,
            packageId: cycle.packageId ? this.getOrCreateTargetId(sourceSystem, "package", cycle.packageId) : null,
            originCycleId: cycle.originCycleId ? this.getOrCreateTargetId(sourceSystem, "cycle", cycle.originCycleId) : null,
            createdAt: cycle.createdAt,
            updatedAt: new Date(),
          });

          await writeAudit(tx, {
            studioId,
            userId: actorUserId,
            action: "cycle_created",
            entityType: "treatment_cycle",
            entityId: targetCycleId,
            before: null,
            after: { sourceId: cycle.sourceId, zone: cycle.zone, stage: cycle.stage },
            reason: `Data migration run ${runId}`,
          });
        }
      }

      // 3. Insert / Sync Appointments
      for (const app of staged.appointments) {
        const targetAppId = this.getOrCreateTargetId(sourceSystem, "appointment", app.sourceId);
        const targetClientId = this.getOrCreateTargetId(sourceSystem, "client", app.clientId);
        const masterId = app.masterId ? (config.staffMappings[app.masterId]?.targetMasterId || app.masterId) : null;
        const serviceId = app.serviceId ? (config.serviceMappings[app.serviceId]?.targetServiceId || app.serviceId) : null;

        if (!masterId || !serviceId) continue;

        const [existingApp] = await tx
          .select({ id: schema.appointments.id })
          .from(schema.appointments)
          .where(eq(schema.appointments.id, targetAppId))
          .limit(1);

        if (!existingApp) {
          await tx.insert(schema.appointments).values({
            id: targetAppId,
            studioId,
            clientId: targetClientId,
            masterId,
            serviceId,
            startAt: app.startTime,
            endAt: app.endTime,
            status: app.status,
            source: "phone",
            notes: app.notes,
            createdById: actorUserId,
            serviceSnapshot: { catalogCode: app.catalogCode || "brows_pmu_primary" },
            clientSnapshot: { sourceId: app.clientId },
            masterSnapshot: { masterId },
            priceSnapshotCents: 35000,
            durationSnapshotMinutes: 120,
            createdAt: app.createdAt,
            updatedAt: new Date(),
          });

          await writeAudit(tx, {
            studioId,
            userId: actorUserId,
            action: "appointment_created",
            entityType: "appointment",
            entityId: targetAppId,
            before: null,
            after: { sourceId: app.sourceId, status: app.status },
            reason: `Data migration run ${runId}`,
          });
        }
      }

      // 4. Insert / Sync Financial Ledger Entries
      for (const fin of staged.finances) {
        const targetEntryId = this.getOrCreateTargetId(sourceSystem, "finance", fin.sourceId);
        const targetClientId = this.getOrCreateTargetId(sourceSystem, "client", fin.clientId);
        const targetAppId = fin.appointmentId ? this.getOrCreateTargetId(sourceSystem, "appointment", fin.appointmentId) : null;
        const targetCycleId = fin.cycleId ? this.getOrCreateTargetId(sourceSystem, "cycle", fin.cycleId) : null;

        const [existingEntry] = await tx
          .select({ id: schema.ledgerEntries.id })
          .from(schema.ledgerEntries)
          .where(eq(schema.ledgerEntries.id, targetEntryId))
          .limit(1);

        if (!existingEntry) {
          await tx.insert(schema.ledgerEntries).values({
            id: targetEntryId,
            studioId,
            clientId: targetClientId,
            appointmentId: targetAppId,
            cycleId: targetCycleId,
            type: fin.type,
            amountMinor: fin.amountMinor,
            currency: fin.currency,
            paymentMethod: fin.method || null,
            reason: fin.notes || (fin.isOpeningBalanceAdjustment ? "MIGRATION_OPENING_BALANCE" : "MIGRATION_LEGACY_IMPORT"),
            createdAt: fin.date,
            createdById: actorUserId,
          });

          const ledgerAction = fin.type === "PAYMENT" ? "payment_recorded" : fin.type === "CHARGE" ? "charge_recorded" : fin.type === "REFUND" ? "refund_recorded" : "ledger_adjustment_recorded";
          await writeAudit(tx, {
            studioId,
            userId: actorUserId,
            action: ledgerAction,
            entityType: "ledger_entry",
            entityId: targetEntryId,
            before: null,
            after: { sourceId: fin.sourceId, type: fin.type, amountMinor: fin.amountMinor },
            reason: `Data migration run ${runId}`,
          });
        }
      }

      // 5. Insert / Sync Conversations & Messages
      for (const conv of staged.conversations) {
        const targetConvId = this.getOrCreateTargetId(sourceSystem, "conversation", conv.sourceId);
        const targetClientId = this.getOrCreateTargetId(sourceSystem, "client", conv.clientId);

        const [existingConv] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, targetConvId))
          .limit(1);

        if (!existingConv) {
          await tx.insert(schema.conversations).values({
            id: targetConvId,
            studioId,
            clientId: targetClientId,
            status: "OPEN",
            createdAt: conv.createdAt,
            updatedAt: new Date(),
          });
        }
      }

      for (const msg of staged.messages) {
        const targetMsgId = this.getOrCreateTargetId(sourceSystem, "message", msg.sourceId);
        const targetConvId = this.getOrCreateTargetId(sourceSystem, "conversation", msg.conversationId);
        const conv = staged.conversations.find((c) => c.sourceId === msg.conversationId);
        const targetClientId = conv ? this.getOrCreateTargetId(sourceSystem, "client", conv.clientId) : staged.clients[0]?.sourceId ? this.getOrCreateTargetId(sourceSystem, "client", staged.clients[0].sourceId) : null;

        if (!targetClientId) continue;

        const [existingMsg] = await tx
          .select({ id: schema.conversationMessages.id })
          .from(schema.conversationMessages)
          .where(eq(schema.conversationMessages.id, targetMsgId))
          .limit(1);

        if (!existingMsg) {
          const rawChannel = (msg.channel || "whatsapp").trim().toUpperCase();
          const channel = ["WHATSAPP", "SMS", "EMAIL", "MANUAL"].includes(rawChannel) ? (rawChannel as "WHATSAPP") : "WHATSAPP";
          const direction = msg.direction === "inbound" ? "INBOUND" : "OUTBOUND";

          await tx.insert(schema.conversationMessages).values({
            id: targetMsgId,
            studioId,
            conversationId: targetConvId,
            clientId: targetClientId,
            direction,
            channel,
            body: msg.body,
            providerMessageId: msg.providerMessageId,
            createdAt: msg.timestamp,
          });
        }
      }
    });

    const completedAt = new Date().toISOString();

    return {
      runId,
      sourceSystem,
      studioId,
      mode: "APPLY",
      startedAt,
      completedAt,
      inputChecksum,
      status: "APPLIED_SUCCESSFULLY",
      counts: staged.counts,
      findings: staged.findings,
      findingCounts: staged.findingCounts,
      financialReconciliation: staged.financialReconciliation,
      cutoverReadiness: staged.cutoverReadiness,
    };
  }
}
