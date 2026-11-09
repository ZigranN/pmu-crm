import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clientMedicalProfiles, treatmentCycles } from "@/db/schema";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { cycleScope, type CycleContext } from "@/features/treatment-cycles/server/scope";
import { getLatestMedicalProfileRevision } from "./revisions";
import { getLatestCycleMedicalClearance } from "./clearance";
import {
  evaluateEffectiveMedicalEligibility,
  type EffectiveMedicalEligibility,
  type EffectiveMedicalEligibilityInput,
} from "../domain/effective-eligibility";

type Executor = typeof db | Transaction;

export type EligibilityContext = CycleContext & {
  [key: string]: unknown;
};

/**
 * PostgreSQL-backed read-only resolver for Effective Medical Eligibility.
 *
 * Guarantees:
 * - Scoped cycle authorization (Studio / Master ownership).
 * - Fails closed if the caller cannot access the treatment cycle.
 * - Consistent read transaction snapshot across all medical evidence tables.
 * - Side-effect free: zero database mutations, no audits/activity writes, no baseline seeding.
 * - Returns structured governance metadata via the pure domain evaluator.
 */
export async function resolveEffectiveMedicalEligibility(
  context: EligibilityContext,
  cycleId: string,
  executor: Executor = db
): Promise<EffectiveMedicalEligibility> {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  entityId.parse(cycleId);

  const resolve = async (tx: Executor): Promise<EffectiveMedicalEligibility> => {
    // 1. Resolve authorized TreatmentCycle using scoped read mechanism
    const scopeCondition = await cycleScope(context, tx);
    const [cycle] = await tx
      .select()
      .from(treatmentCycles)
      .where(and(eq(treatmentCycles.id, cycleId), scopeCondition));

    if (!cycle) {
      throw new Error("Цикл недоступен");
    }

    // 2. Fetch authoritative active medical profile for the cycle's client
    const [currentMedicalProfile] = await tx
      .select()
      .from(clientMedicalProfiles)
      .where(
        and(
          eq(clientMedicalProfiles.clientId, cycle.clientId),
          isNull(clientMedicalProfiles.supersededAt)
        )
      );

    // 3. Fetch latest authoritative revision for the cycle's client within the studio
    const currentMedicalRevision = await getLatestMedicalProfileRevision(
      context.studioId,
      cycle.clientId,
      tx
    );

    // 4. Fetch latest medical clearance for the cycle within the studio
    const latestCycleMedicalClearance = await getLatestCycleMedicalClearance(
      context.studioId,
      cycle.id,
      tx
    );

    // 5. Construct pure evaluator input
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: cycle.id,
      clientId: cycle.clientId,
      cycleStage: cycle.stage,
      currentMedicalProfile: currentMedicalProfile ?? null,
      currentMedicalRevision: currentMedicalRevision ?? null,
      latestCycleMedicalClearance: latestCycleMedicalClearance ?? null,
      mergeReviewRequired: currentMedicalProfile?.mergeReviewRequired ?? false,
    };

    // 6. Evaluate deterministic eligibility
    return evaluateEffectiveMedicalEligibility(input);
  };

  // If no external transaction executor is provided, wrap reads in a transaction for snapshot consistency
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
