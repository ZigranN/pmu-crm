import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycleConsents, cycleConsentZones, treatmentCycles } from "@/db/schema";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { cycleScope, type CycleContext } from "@/features/treatment-cycles/server/scope";
import {
  evaluateEffectiveConsent,
  type EffectiveConsent,
  type EffectiveConsentInput,
} from "../domain/effective-consent";

type Executor = typeof db | Transaction;

export type ConsentCoverageContext = CycleContext;

/**
 * PostgreSQL-backed read-only resolver for Effective Consent.
 *
 * Guarantees:
 * - Scoped cycle authorization (Studio / Master ownership).
 * - Fails closed if the caller cannot access the treatment cycle.
 * - Consistent read transaction snapshot across consent evidence tables.
 * - Side-effect free: zero database mutations, no audits/activity writes.
 * - Only evaluates cycle_consents and cycle_consent_zones (legacy consents ignored).
 * - Deterministic latest-applicable signed consent resolution.
 */
export async function resolveEffectiveConsent(
  context: ConsentCoverageContext,
  cycleId: string,
  executor: Executor = db
): Promise<EffectiveConsent> {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  entityId.parse(cycleId);

  const resolve = async (tx: Executor): Promise<EffectiveConsent> => {
    // 1. Resolve authorized TreatmentCycle using scoped read mechanism
    const scopeCondition = await cycleScope(context, tx);
    const [cycle] = await tx
      .select({
        id: treatmentCycles.id,
        studioId: treatmentCycles.studioId,
        clientId: treatmentCycles.clientId,
        stage: treatmentCycles.stage,
        zoneCode: treatmentCycles.zoneCode,
      })
      .from(treatmentCycles)
      .where(and(eq(treatmentCycles.id, cycleId), scopeCondition));

    if (!cycle) {
      throw new Error("Treatment cycle not found or inaccessible");
    }

    // 2. Fetch latest applicable signed cycle consent for this cycle within the studio
    const [latestConsent] = await tx
      .select({
        id: cycleConsents.id,
        cycleId: cycleConsents.cycleId,
        clientId: cycleConsents.clientId,
        templateVersionId: cycleConsents.templateVersionId,
        status: cycleConsents.status,
        mediaId: cycleConsents.mediaId,
        signedAt: cycleConsents.signedAt,
        signedPdfSha256: cycleConsents.signedPdfSha256,
      })
      .from(cycleConsents)
      .where(
        and(
          eq(cycleConsents.studioId, context.studioId),
          eq(cycleConsents.cycleId, cycle.id),
          eq(cycleConsents.status, "SIGNED")
        )
      )
      .orderBy(
        desc(cycleConsents.signedAt),
        desc(cycleConsents.createdAt),
        desc(cycleConsents.id)
      )
      .limit(1);

    // 3. If signed consent exists, fetch its covered zone codes
    let coveredZoneCodes: string[] = [];
    if (latestConsent) {
      const zoneRows = await tx
        .select({
          zoneCode: cycleConsentZones.zoneCode,
        })
        .from(cycleConsentZones)
        .where(
          and(
            eq(cycleConsentZones.studioId, context.studioId),
            eq(cycleConsentZones.consentId, latestConsent.id)
          )
        );

      coveredZoneCodes = zoneRows.map((r) => r.zoneCode);
    }

    // 4. Construct pure evaluator input
    const input: EffectiveConsentInput = {
      cycleId: cycle.id,
      clientId: cycle.clientId,
      cycleStage: cycle.stage,
      cycleZoneCode: cycle.zoneCode,
      latestCycleConsent: latestConsent ?? null,
      coveredZoneCodes,
    };

    // 5. Evaluate deterministic consent coverage
    return evaluateEffectiveConsent(input);
  };

  // If no external transaction executor is provided, wrap in repeatable read for snapshot consistency
  if (executor === db) {
    return db.transaction(
      async (tx) => resolve(tx),
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      }
    );
  }

  return resolve(executor);
}
