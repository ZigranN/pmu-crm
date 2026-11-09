import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import {
  appointmentCycles,
  appointments,
  commandReceipts,
  pigments,
  procedurePigments,
  procedureSessions,
  services,
  treatmentCycles,
} from "@/db/schema";
import { resolveEffectiveConsent } from "@/features/consent/server/coverage";
import { resolveEffectiveMedicalEligibility } from "@/features/medical/server/eligibility";
import { recordCycleChange } from "@/features/treatment-cycles/server/mutation";
import { hasPermission } from "@/lib/permissions";
import { type Transaction } from "@/server/commands/ownership";
import { writeAudit } from "@/server/services/audit-log.service";
import { dispatchAutomationTrigger } from "@/features/automations/server/engine";
import {
  ABORT_PROCEDURE_SCHEMA,
  COMPLETE_PROCEDURE_SCHEMA,
  START_PROCEDURE_SCHEMA,
  UPDATE_PROCEDURE_EVIDENCE_SCHEMA,
  type AbortProcedureInput,
  type CompleteProcedureInput,
  type StartProcedureInput,
  type UpdateProcedureEvidenceInput,
} from "../schemas/procedure.schema";
import { acquireProcedureExecutionLocks } from "./locks";
import { lockProcedureSession, type ProcedureContext } from "./scope";

type Executor = typeof db | Transaction;

/**
 * Starts a procedure session with full transactional safety:
 * 1. Authenticates context & checks permissions.
 * 2. Resolves appointment, cycle, client, and master.
 * 3. Acquires deterministic PostgreSQL locks (Studio -> Master -> Client -> Cycle -> Appointment).
 * 4. Validates appointment status & cycle state.
 * 5. Re-checks real-time medical eligibility (must be CLEARED).
 * 6. Re-checks real-time signed consent coverage (must be COVERED).
 * 7. Checks for duplicate/active in-progress sessions.
 * 8. Creates ProcedureSession in IN_PROGRESS state with immutable snapshots.
 * 9. Writes audit log and returns created session.
 */
export async function startProcedureSession(
  context: ProcedureContext,
  rawInput: StartProcedureInput,
  executor: Executor = db
) {
  const input = START_PROCEDURE_SCHEMA.parse(rawInput);

  const execute = async (tx: Transaction) => {
    // 1. Permission check
    const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_CREATE");
    if (!allowed) {
      throw new Error("Недостаточно прав для начала процедуры");
    }

    // 2. Pre-fetch cycle to resolve client & default master
    const [cycleRow] = await tx
      .select()
      .from(treatmentCycles)
      .where(
        and(
          eq(treatmentCycles.id, input.cycleId),
          eq(treatmentCycles.studioId, context.studioId),
          isNull(treatmentCycles.archivedAt)
        )
      );

    if (!cycleRow) {
      throw new Error("Цикл лечения не найден или архивирован");
    }

    // 3. Resolve linked appointment if specified
    let appointmentRow = null;
    if (input.appointmentId) {
      const [app] = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.id, input.appointmentId),
            eq(appointments.studioId, context.studioId),
            isNull(appointments.deletedAt)
          )
        );

      if (!app) {
        throw new Error("Запись визита не найдена в этой студии");
      }
      if (app.status === "cancelled" || app.status === "no_show") {
        throw new Error(`Невозможно начать процедуру по визиту в статусе ${app.status}`);
      }
      if (app.clientId !== cycleRow.clientId) {
        throw new Error("Клиент визита не совпадает с клиентом цикла лечения");
      }
      appointmentRow = app;
    }

    const masterId = input.masterId || appointmentRow?.masterId || cycleRow.assignedMasterId;
    if (!masterId) {
      throw new Error("Мастер процедуры не определен");
    }

    // 4. Acquire deterministic locks
    const { master, client, cycle, appointment } = await acquireProcedureExecutionLocks(
      tx,
      context,
      {
        masterId,
        clientId: cycleRow.clientId,
        cycleId: cycleRow.id,
        appointmentId: appointmentRow?.id ?? null,
      }
    );

    // 5. Coherence and state guards
    if (cycle.suspendedAt) {
      throw new Error("Цикл приостановлен: требуется решение мастера");
    }

    // 6. Medical Eligibility Guard
    const medicalEligibility = await resolveEffectiveMedicalEligibility(context, cycle.id, tx);
    if (medicalEligibility.status !== "CLEARED") {
      throw new Error(
        `Невозможно начать процедуру: медицинский допуск не получен (статус: ${medicalEligibility.status}, причина: ${medicalEligibility.reasonCode})`
      );
    }

    // 7. Effective Consent Guard
    const consent = await resolveEffectiveConsent(context, cycle.id, tx);
    if (consent.status !== "COVERED") {
      throw new Error(
        `Невозможно начать процедуру: отсутствует действующее подписанное согласие для зоны ${cycle.zoneCode} (статус: ${consent.status})`
      );
    }

    // 8. Prevent duplicate active procedures
    const existingActiveCycle = await tx
      .select({ id: procedureSessions.id })
      .from(procedureSessions)
      .where(
        and(
          eq(procedureSessions.studioId, context.studioId),
          eq(procedureSessions.cycleId, cycle.id),
          eq(procedureSessions.status, "IN_PROGRESS"),
          isNull(procedureSessions.deletedAt)
        )
      )
      .limit(1);

    if (existingActiveCycle.length > 0) {
      throw new Error("Процедура для этого цикла уже выполняется");
    }

    // 9. Resolve Service & Snapshots
    let serviceRow = null;
    if (input.serviceId) {
      const [s] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, input.serviceId), eq(services.studioId, context.studioId)));
      serviceRow = s;
    } else if (appointment?.serviceId) {
      const [s] = await tx
        .select()
        .from(services)
        .where(and(eq(services.id, appointment.serviceId), eq(services.studioId, context.studioId)));
      serviceRow = s;
    }

    if (!serviceRow) {
      const [s] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.studioId, context.studioId),
            eq(services.isActive, true),
            isNull(services.deletedAt)
          )
        )
        .limit(1);
      serviceRow = s;
    }

    if (!serviceRow) {
      throw new Error("Услуга для процедуры не найдена");
    }

    // 10. Determine sessionType & procedure Area/Type
    let sessionType: "primary_session" | "second_session" | "correction" | "refresh" | "touch_up" =
      "primary_session";
    let cycleVisitKind: "session_1" | "session_2" | "correction" | "refresh" | "single_session" = "session_1";
    if (cycle.stage === "second_session_scheduled") {
      sessionType = "second_session";
      cycleVisitKind = "session_2";
    } else if (cycle.kind === "refresh") {
      sessionType = "refresh";
      cycleVisitKind = "refresh";
    } else if (cycle.kind === "paid_correction" || cycle.kind === "free_correction") {
      sessionType = "correction";
      cycleVisitKind = "correction";
    }

    const procedureArea = (cycle.zoneCode as "brows" | "lips" | "eyes" | "skin") || "brows";
    const procedureType =
      (serviceRow.procedureType as "brows" | "lips" | "eyes" | "correction" | "refresh") ||
      procedureArea;

    const startedAtDate = input.startedAt ? new Date(input.startedAt) : new Date();
    const commandId = input.commandId || randomUUID();

    const serviceSnapshot = {
      id: serviceRow.id,
      name: serviceRow.name,
      category: serviceRow.category,
      procedureType: serviceRow.procedureType,
      priceCents: serviceRow.priceCents,
      durationMinutes: serviceRow.durationMinutes,
    };

    const masterSnapshot = {
      id: master.id,
      displayName: master.displayName,
    };

    const clientSnapshot = {
      id: client.id,
      fullName: client.fullName,
      phone: client.phone,
    };

    if (appointment) {
      // Link appointment and cycle in appointmentCycles if not linked
      const existingCycleLink = await tx
        .select({ id: appointmentCycles.id })
        .from(appointmentCycles)
        .where(
          and(
            eq(appointmentCycles.appointmentId, appointment.id),
            eq(appointmentCycles.cycleId, cycle.id),
            eq(appointmentCycles.studioId, context.studioId)
          )
        )
        .limit(1);

      if (existingCycleLink.length === 0) {
        await tx.insert(appointmentCycles).values({
          studioId: context.studioId,
          clientId: client.id,
          appointmentId: appointment.id,
          cycleId: cycle.id,
          visitKind: cycleVisitKind,
          serviceSnapshot,
        });
      }
    }

    // 11. Create ProcedureSession
    const [newSession] = await tx
      .insert(procedureSessions)
      .values({
        studioId: context.studioId,
        clientId: client.id,
        cycleId: cycle.id,
        appointmentId: appointment?.id ?? null,
        masterId: master.id,
        serviceId: serviceRow.id,
        status: "IN_PROGRESS",
        startedAt: startedAtDate,
        procedureArea: procedureArea as any,
        procedureType: procedureType as any,
        sessionType: sessionType as any,
        notes: input.notes ?? null,
        commandId,
        serviceSnapshot,
        masterSnapshot,
        clientSnapshot,
      })
      .returning();

    // 12. Write Audit Log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "procedure_started",
      entityType: "procedure_session",
      entityId: newSession.id,
      before: null,
      after: {
        id: newSession.id,
        cycleId: newSession.cycleId,
        appointmentId: newSession.appointmentId,
        masterId: newSession.masterId,
        status: newSession.status,
        startedAt: newSession.startedAt,
      },
      reason: input.notes || "Начало процедуры",
      reasonSource: "command",
    });

    return newSession;
  };

  if ("transaction" in executor && typeof executor.transaction === "function") {
    return executor.transaction(execute);
  }
  return execute(executor as Transaction);
}

/**
 * Completes a procedure session with recorded evidence:
 * 1. Authenticates context & checks permissions.
 * 2. Acquires deterministic locks.
 * 3. Enforces session is in IN_PROGRESS state.
 * 4. Records materials, equipment, skin reaction, pain level, recommendations, next step, and pigments.
 * 5. Transitions TreatmentCycle stage (procedure_confirmed -> first_session_completed, second_session_scheduled -> second_session_completed).
 * 6. Completes linked appointment if present.
 * 7. Writes audit log and returns updated session.
 */
export async function completeProcedureSession(
  context: ProcedureContext,
  rawInput: CompleteProcedureInput,
  executor: Executor = db
) {
  const input = COMPLETE_PROCEDURE_SCHEMA.parse(rawInput);

  const execute = async (tx: Transaction) => {
    // 1. Permission check
    const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_UPDATE");
    if (!allowed) {
      throw new Error("Недостаточно прав для завершения процедуры");
    }

    // 2. Pre-fetch session
    const [existingSession] = await tx
      .select()
      .from(procedureSessions)
      .where(
        and(
          eq(procedureSessions.id, input.procedureSessionId),
          eq(procedureSessions.studioId, context.studioId),
          isNull(procedureSessions.deletedAt)
        )
      );

    if (!existingSession) {
      throw new Error("Сессия процедуры не найдена");
    }

    if (existingSession.status !== "IN_PROGRESS") {
      throw new Error(
        `Завершить можно только процедуру в статусе IN_PROGRESS (текущий статус: ${existingSession.status})`
      );
    }

    if (!existingSession.cycleId) {
      throw new Error("Сессия процедуры не привязана к циклу лечения");
    }

    // 3. Acquire deterministic locks
    const { cycle, appointment, session } =
      await acquireProcedureExecutionLocks(tx, context, {
        masterId: existingSession.masterId,
        clientId: existingSession.clientId,
        cycleId: existingSession.cycleId,
        appointmentId: existingSession.appointmentId,
        procedureSessionId: existingSession.id,
      });

    if (!session || session.status !== "IN_PROGRESS") {
      throw new Error(
        `Завершить можно только процедуру в статусе IN_PROGRESS (текущий статус: ${session?.status ?? "НЕ НАЙДЕНА"})`
      );
    }

    const completedAtDate = input.completedAt ? new Date(input.completedAt) : new Date();

    // 4. Update ProcedureSession to COMPLETED
    const [updatedSession] = await tx
      .update(procedureSessions)
      .set({
        status: "COMPLETED",
        completedAt: completedAtDate,
        healingStage: input.healingStage ?? session!.healingStage,
        anesthesia: input.anesthesia ?? session!.anesthesia,
        cartridge: input.cartridge ?? session!.cartridge,
        needle: input.needle ?? session!.needle,
        voltage: input.voltage ?? session!.voltage,
        machine: input.machine ?? session!.machine,
        skinReaction: input.skinReaction ?? session!.skinReaction,
        painLevel: input.painLevel !== undefined ? input.painLevel : session!.painLevel,
        notes: input.notes ?? session!.notes,
        recommendations: input.recommendations ?? session!.recommendations,
        nextStep: input.nextStep ?? session!.nextStep,
        nextRecommendedDate: input.nextRecommendedDate
          ? new Date(input.nextRecommendedDate)
          : session!.nextRecommendedDate,
        techniqueId: input.techniqueId ?? session!.techniqueId,
        techniqueSnapshot: input.techniqueSnapshot ?? session!.techniqueSnapshot,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(procedureSessions.id, session!.id),
          eq(procedureSessions.studioId, context.studioId)
        )
      )
      .returning();

    // 5. Record Pigments evidence
    if (input.pigments && input.pigments.length > 0) {
      for (const p of input.pigments) {
        const [pigmentRow] = await tx
          .select()
          .from(pigments)
          .where(and(eq(pigments.id, p.pigmentId), eq(pigments.studioId, context.studioId)));

        if (!pigmentRow) {
          throw new Error(`Пигмент с ID ${p.pigmentId} не найден`);
        }

        const pigmentSnapshot = {
          id: pigmentRow.id,
          brand: pigmentRow.brand,
          name: pigmentRow.name,
          color: pigmentRow.color,
          code: pigmentRow.code,
          temperature: pigmentRow.temperature,
          baseType: pigmentRow.baseType,
          compositionType: pigmentRow.compositionType,
        };

        await tx.insert(procedurePigments).values({
          procedureSessionId: updatedSession.id,
          pigmentId: pigmentRow.id,
          pigmentSnapshot,
          mixRatio: p.mixRatio ?? null,
          drops: p.drops ?? null,
          notes: p.notes ?? null,
        });
      }
    }

    // 6. Transition TreatmentCycle stage
    const stageCommandId = input.commandId || randomUUID();
    if (!input.commandId) {
      await tx.insert(commandReceipts).values({
        id: stageCommandId,
        studioId: context.studioId,
        actorId: context.userId,
        command: "procedure.complete.v1",
        requestKey: randomUUID(),
        payloadHash: "0".repeat(64),
        result: { id: cycle.id, cycleId: cycle.id, procedureSessionId: updatedSession.id },
      });
    }

    if (cycle.stage === "procedure_confirmed") {
      await recordCycleChange(
        tx,
        context,
        stageCommandId,
        cycle,
        "first_session_completed",
        "Первая процедура завершена",
        "cycle_stage_changed",
        {}
      );
      if (!cycle.firstSessionAt) {
        await tx
          .update(treatmentCycles)
          .set({ firstSessionAt: completedAtDate, updatedAt: new Date() })
          .where(
            and(eq(treatmentCycles.id, cycle.id), eq(treatmentCycles.studioId, context.studioId))
          );
      }
    } else if (cycle.stage === "second_session_scheduled") {
      await recordCycleChange(
        tx,
        context,
        stageCommandId,
        cycle,
        "second_session_completed",
        "Вторая процедура завершена",
        "cycle_stage_changed",
        {}
      );
      if (!cycle.secondSessionAt) {
        await tx
          .update(treatmentCycles)
          .set({ secondSessionAt: completedAtDate, updatedAt: new Date() })
          .where(
            and(eq(treatmentCycles.id, cycle.id), eq(treatmentCycles.studioId, context.studioId))
          );
      }
    }

    // 7. Complete Appointment if linked
    if (appointment && appointment.status !== "completed") {
      await tx
        .update(appointments)
        .set({ status: "completed", updatedAt: new Date() })
        .where(
          and(
            eq(appointments.id, appointment.id),
            eq(appointments.studioId, context.studioId)
          )
        );
    }

    // 8. Write Audit Log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "procedure_completed",
      entityType: "procedure_session",
      entityId: updatedSession.id,
      before: {
        id: session!.id,
        status: session!.status,
      },
      after: {
        id: updatedSession.id,
        status: updatedSession.status,
        completedAt: updatedSession.completedAt,
        painLevel: updatedSession.painLevel,
        nextStep: updatedSession.nextStep,
      },
      reason: input.notes || "Процедура успешно завершена",
      reasonSource: "command",
    });

    // 9. Dispatch automations (procedure follow-up)
    await dispatchAutomationTrigger(tx, context, {
      type: "PROCEDURE_COMPLETED",
      studioId: context.studioId,
      entityType: "procedure_session",
      entityId: updatedSession.id,
      clientId: updatedSession.clientId,
      referenceTime: updatedSession.completedAt ?? new Date(),
      metadata: {
        cycleId: updatedSession.cycleId,
        appointmentId: updatedSession.appointmentId,
        nextStep: updatedSession.nextStep,
      },
    });

    return updatedSession;
  };

  if ("transaction" in executor && typeof executor.transaction === "function") {
    return executor.transaction(execute);
  }
  return execute(executor as Transaction);
}

/**
 * Aborts an active procedure session:
 * 1. Authenticates context & checks permissions.
 * 2. Acquires deterministic locks.
 * 3. Enforces session is in IN_PROGRESS state.
 * 4. Records abort reason and timestamp.
 * 5. Leaves TreatmentCycle in its current stage without unauthorized progression.
 * 6. Writes audit log and returns updated session.
 */
export async function abortProcedureSession(
  context: ProcedureContext,
  rawInput: AbortProcedureInput,
  executor: Executor = db
) {
  const input = ABORT_PROCEDURE_SCHEMA.parse(rawInput);

  const execute = async (tx: Transaction) => {
    // 1. Permission check
    const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_UPDATE");
    if (!allowed) {
      throw new Error("Недостаточно прав для прерывания процедуры");
    }

    // 2. Pre-fetch session
    const [existingSession] = await tx
      .select()
      .from(procedureSessions)
      .where(
        and(
          eq(procedureSessions.id, input.procedureSessionId),
          eq(procedureSessions.studioId, context.studioId),
          isNull(procedureSessions.deletedAt)
        )
      );

    if (!existingSession) {
      throw new Error("Сессия процедуры не найдена");
    }

    if (existingSession.status !== "IN_PROGRESS") {
      throw new Error(
        `Прервать можно только процедуру в статусе IN_PROGRESS (текущий статус: ${existingSession.status})`
      );
    }

    if (!existingSession.cycleId) {
      throw new Error("Сессия процедуры не привязана к циклу лечения");
    }

    // 3. Acquire deterministic locks
    const { session } = await acquireProcedureExecutionLocks(tx, context, {
      masterId: existingSession.masterId,
      clientId: existingSession.clientId,
      cycleId: existingSession.cycleId,
      appointmentId: existingSession.appointmentId,
      procedureSessionId: existingSession.id,
    });

    if (!session || session.status !== "IN_PROGRESS") {
      throw new Error(
        `Прервать можно только процедуру в статусе IN_PROGRESS (текущий статус: ${session?.status ?? "НЕ НАЙДЕНА"})`
      );
    }

    const abortedAtDate = input.abortedAt ? new Date(input.abortedAt) : new Date();

    // 4. Update ProcedureSession to ABORTED
    const [updatedSession] = await tx
      .update(procedureSessions)
      .set({
        status: "ABORTED",
        abortedAt: abortedAtDate,
        abortReason: input.reason,
        notes: input.notes ?? session!.notes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(procedureSessions.id, session!.id),
          eq(procedureSessions.studioId, context.studioId)
        )
      )
      .returning();

    // 5. Write Audit Log
    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "procedure_aborted",
      entityType: "procedure_session",
      entityId: updatedSession.id,
      before: {
        id: session!.id,
        status: session!.status,
      },
      after: {
        id: updatedSession.id,
        status: updatedSession.status,
        abortedAt: updatedSession.abortedAt,
        abortReason: updatedSession.abortReason,
      },
      reason: input.reason,
      reasonSource: "command",
    });

    return updatedSession;
  };

  if ("transaction" in executor && typeof executor.transaction === "function") {
    return executor.transaction(execute);
  }
  return execute(executor as Transaction);
}

/**
 * Updates procedure session evidence while in progress or recording details:
 */
export async function updateProcedureEvidence(
  context: ProcedureContext,
  rawInput: UpdateProcedureEvidenceInput,
  executor: Executor = db
) {
  const input = UPDATE_PROCEDURE_EVIDENCE_SCHEMA.parse(rawInput);

  const execute = async (tx: Transaction) => {
    const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_UPDATE");
    if (!allowed) {
      throw new Error("Недостаточно прав для изменения свидетельств процедуры");
    }

    const session = await lockProcedureSession(tx, context, input.procedureSessionId);

    const [updatedSession] = await tx
      .update(procedureSessions)
      .set({
        healingStage: input.healingStage ?? session.healingStage,
        anesthesia: input.anesthesia ?? session.anesthesia,
        cartridge: input.cartridge ?? session.cartridge,
        needle: input.needle ?? session.needle,
        voltage: input.voltage ?? session.voltage,
        machine: input.machine ?? session.machine,
        skinReaction: input.skinReaction ?? session.skinReaction,
        painLevel: input.painLevel !== undefined ? input.painLevel : session.painLevel,
        notes: input.notes ?? session.notes,
        recommendations: input.recommendations ?? session.recommendations,
        techniqueId: input.techniqueId ?? session.techniqueId,
        techniqueSnapshot: input.techniqueSnapshot ?? session.techniqueSnapshot,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(procedureSessions.id, session.id),
          eq(procedureSessions.studioId, context.studioId)
        )
      )
      .returning();

    if (input.pigments) {
      // Clear previous pigments and insert new ones
      await tx
        .delete(procedurePigments)
        .where(eq(procedurePigments.procedureSessionId, session.id));

      for (const p of input.pigments) {
        const [pigmentRow] = await tx
          .select()
          .from(pigments)
          .where(and(eq(pigments.id, p.pigmentId), eq(pigments.studioId, context.studioId)));

        if (pigmentRow) {
          const pigmentSnapshot = {
            id: pigmentRow.id,
            brand: pigmentRow.brand,
            name: pigmentRow.name,
            color: pigmentRow.color,
            code: pigmentRow.code,
            temperature: pigmentRow.temperature,
            baseType: pigmentRow.baseType,
          };

          await tx.insert(procedurePigments).values({
            procedureSessionId: session.id,
            pigmentId: pigmentRow.id,
            pigmentSnapshot,
            mixRatio: p.mixRatio ?? null,
            drops: p.drops ?? null,
            notes: p.notes ?? null,
          });
        }
      }
    }

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "procedure_evidence_updated",
      entityType: "procedure_session",
      entityId: updatedSession.id,
      before: {
        id: session.id,
        notes: session.notes,
        painLevel: session.painLevel,
      },
      after: {
        id: updatedSession.id,
        notes: updatedSession.notes,
        painLevel: updatedSession.painLevel,
      },
      reason: "Обновление свидетельств процедуры",
      reasonSource: "command",
    });

    return updatedSession;
  };

  if ("transaction" in executor && typeof executor.transaction === "function") {
    return executor.transaction(execute);
  }
  return execute(executor as Transaction);
}
