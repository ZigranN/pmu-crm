"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cycleMedicalClearances, type CycleMedicalClearanceDecision } from "@/db/schema";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { idempotentCommand } from "@/server/commands/idempotency";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";
import { lockCycle } from "@/features/treatment-cycles/server/scope";
import {
  getLatestMedicalProfileRevision,
  getMedicalProfileRevisionById,
} from "./revisions";
import {
  recordMedicalClearanceSchema,
  type RecordMedicalClearanceInput,
} from "../schemas/clearance.schema";

type Executor = typeof db | Transaction;
export type CycleMedicalClearance = typeof cycleMedicalClearances.$inferSelect;

export type RecordMedicalClearanceResult = {
  id: string;
  cycleId: string;
  medicalRevisionId: string;
  decisionNumber: number;
  decision: CycleMedicalClearanceDecision;
};

export async function getLatestCycleMedicalClearance(
  studioId: string,
  cycleId: string,
  executor: Executor = db
): Promise<CycleMedicalClearance | undefined> {
  entityId.parse(studioId);
  entityId.parse(cycleId);
  const [latest] = await executor
    .select()
    .from(cycleMedicalClearances)
    .where(
      and(
        eq(cycleMedicalClearances.studioId, studioId),
        eq(cycleMedicalClearances.cycleId, cycleId)
      )
    )
    .orderBy(desc(cycleMedicalClearances.decisionNumber))
    .limit(1);
  return latest;
}

export async function getCycleMedicalClearances(
  studioId: string,
  cycleId: string,
  executor: Executor = db
): Promise<CycleMedicalClearance[]> {
  entityId.parse(studioId);
  entityId.parse(cycleId);
  return executor
    .select()
    .from(cycleMedicalClearances)
    .where(
      and(
        eq(cycleMedicalClearances.studioId, studioId),
        eq(cycleMedicalClearances.cycleId, cycleId)
      )
    )
    .orderBy(asc(cycleMedicalClearances.decisionNumber));
}

export async function getMedicalClearanceById(
  studioId: string,
  clearanceId: string,
  executor: Executor = db
): Promise<CycleMedicalClearance | undefined> {
  entityId.parse(studioId);
  entityId.parse(clearanceId);
  const [clearance] = await executor
    .select()
    .from(cycleMedicalClearances)
    .where(
      and(
        eq(cycleMedicalClearances.id, clearanceId),
        eq(cycleMedicalClearances.studioId, studioId)
      )
    );
  return clearance;
}

export async function recordMedicalClearanceAction(
  input: RecordMedicalClearanceInput,
  requestKey: string
): Promise<RecordMedicalClearanceResult> {
  const data = recordMedicalClearanceSchema.parse(input);
  const context = await requireBrowserStudioPermission("MEDICAL_PROFILE_UPDATE");

  const result = await idempotentCommand(
    context,
    "MEDICAL_PROFILE_UPDATE",
    "cycle.medical-clearance-record.v1",
    requestKey,
    data,
    async (tx, commandId) => {
      // 5. Lock treatment cycle via lockCycle
      const cycle = await lockCycle(tx, context, data.cycleId);

      // 6. Verify expectedCycleVersion
      if (cycle.version !== data.expectedCycleVersion) {
        throw new Error("Цикл изменен. Обновите страницу перед следующим действием");
      }

      // 7. Read referenced MedicalProfileRevision using SAME transaction
      const revision = await getMedicalProfileRevisionById(
        context.studioId,
        data.medicalRevisionId,
        tx
      );

      // 8. Verify Studio/client/revision ownership
      if (!revision) {
        throw new Error("Медицинская ревизия не найдена");
      }
      if (revision.studioId !== cycle.studioId || revision.clientId !== cycle.clientId) {
        throw new Error("Медицинская ревизия не принадлежит клиенту цикла");
      }

      // For a NEW clearance decision, verify that the referenced revision is the client's current latest persisted revision.
      const latestRevision = await getLatestMedicalProfileRevision(
        context.studioId,
        cycle.clientId,
        tx
      );
      if (!latestRevision || latestRevision.id !== revision.id) {
        throw new Error("Медицинские данные были обновлены. Проверьте актуальную ревизию профиля.");
      }

      // 9. Allocate next decisionNumber under cycle lock
      const latestClearance = await getLatestCycleMedicalClearance(
        context.studioId,
        cycle.id,
        tx
      );
      const nextDecisionNumber = (latestClearance?.decisionNumber ?? 0) + 1;

      // 10. Insert clearance row
      const [clearance] = await tx
        .insert(cycleMedicalClearances)
        .values({
          studioId: context.studioId,
          cycleId: cycle.id,
          medicalRevisionId: revision.id,
          decisionNumber: nextDecisionNumber,
          decision: data.decision,
          reason: data.reason,
          clinicalNotes: data.clinicalNotes ?? null,
          decidedById: context.userId,
        })
        .returning();

      // 11. Write dedicated audit record
      await writeAudit(tx, {
        studioId: context.studioId,
        userId: context.userId,
        action: "medical_clearance_recorded",
        entityType: "cycle_medical_clearance",
        entityId: clearance.id,
        before: null,
        after: {
          id: clearance.id,
          cycleId: clearance.cycleId,
          clientId: cycle.clientId,
          medicalRevisionId: clearance.medicalRevisionId,
          decisionNumber: clearance.decisionNumber,
          decision: clearance.decision,
        },
        reason: data.reason,
        reasonSource: "user",
        metadata: {
          cycleId: cycle.id,
          clientId: cycle.clientId,
          medicalRevisionId: revision.id,
          decisionNumber: clearance.decisionNumber,
          decision: clearance.decision,
          commandId,
        },
      });

      // 12. Persist command receipt
      return {
        id: clearance.id,
        cycleId: clearance.cycleId,
        medicalRevisionId: clearance.medicalRevisionId,
        decisionNumber: clearance.decisionNumber,
        decision: clearance.decision,
      };
    },
    async (tx, receiptResult) => {
      // 12. Idempotent replay: validateReplay
      const cycle = await lockCycle(tx, context, receiptResult.cycleId);
      const clearance = await getMedicalClearanceById(context.studioId, receiptResult.id, tx);
      if (!clearance) {
        throw new Error("Medical clearance not found");
      }
      if (
        clearance.studioId !== context.studioId ||
        clearance.cycleId !== cycle.id ||
        clearance.medicalRevisionId !== receiptResult.medicalRevisionId ||
        clearance.decisionNumber !== receiptResult.decisionNumber ||
        clearance.decision !== receiptResult.decision
      ) {
        throw new Error("Medical clearance replay state mismatch");
      }
    }
  );

  revalidatePath(`/deals/${result.cycleId}`);
  return result;
}
