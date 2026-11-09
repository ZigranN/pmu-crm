import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { appointments, clients, masters, procedureSessions, treatmentCycles } from "@/db/schema";
import { lockStudioAccess } from "@/server/auth/scopes";
import { entityId, type Transaction } from "@/server/commands/ownership";
import type { ProcedureContext } from "./scope";

export interface ProcedureLocksParams {
  masterId: string;
  clientId: string;
  cycleId: string;
  appointmentId?: string | null;
  procedureSessionId?: string | null;
}

/**
 * Acquires deterministic PostgreSQL row locks to prevent TOCTOU and concurrent deadlocks.
 *
 * Deterministic Order:
 * 1. Studio Access (lockStudioAccess)
 * 2. Master row (FOR UPDATE)
 * 3. Client row (FOR UPDATE)
 * 4. TreatmentCycle row (FOR UPDATE)
 * 5. Appointment row (FOR UPDATE, if present)
 * 6. ProcedureSession row (FOR UPDATE, if present)
 */
export async function acquireProcedureExecutionLocks(
  tx: Transaction,
  context: ProcedureContext,
  params: ProcedureLocksParams
) {
  entityId.parse(context.studioId);
  entityId.parse(params.masterId);
  entityId.parse(params.clientId);
  entityId.parse(params.cycleId);
  if (params.appointmentId) entityId.parse(params.appointmentId);
  if (params.procedureSessionId) entityId.parse(params.procedureSessionId);

  // 1. Lock Studio Access
  await lockStudioAccess(tx, context);

  // 2. Lock Master row
  const [masterRow] = await tx
    .select()
    .from(masters)
    .where(
      and(
        eq(masters.id, params.masterId),
        eq(masters.studioId, context.studioId),
        isNull(masters.deletedAt)
      )
    )
    .for("update");

  if (!masterRow) {
    throw new Error("Мастер не найден в этой студии");
  }

  // 3. Lock Client row
  const [clientRow] = await tx
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.id, params.clientId),
        eq(clients.studioId, context.studioId),
        isNull(clients.deletedAt)
      )
    )
    .for("update");

  if (!clientRow) {
    throw new Error("Клиент не найден в этой студии");
  }

  // 4. Lock TreatmentCycle row
  const [cycleRow] = await tx
    .select()
    .from(treatmentCycles)
    .where(
      and(
        eq(treatmentCycles.id, params.cycleId),
        eq(treatmentCycles.studioId, context.studioId),
        isNull(treatmentCycles.archivedAt)
      )
    )
    .for("update");

  if (!cycleRow) {
    throw new Error("Цикл лечения не найден или архивирован");
  }

  // 5. Lock Appointment row (if provided)
  let appointmentRow = null;
  if (params.appointmentId) {
    const [app] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, params.appointmentId),
          eq(appointments.studioId, context.studioId),
          isNull(appointments.deletedAt)
        )
      )
      .for("update");

    if (!app) {
      throw new Error("Запись визита не найдена в этой студии");
    }
    appointmentRow = app;
  }

  // 6. Lock ProcedureSession row (if provided)
  let sessionRow = null;
  if (params.procedureSessionId) {
    const [sess] = await tx
      .select()
      .from(procedureSessions)
      .where(
        and(
          eq(procedureSessions.id, params.procedureSessionId),
          eq(procedureSessions.studioId, context.studioId),
          isNull(procedureSessions.deletedAt)
        )
      )
      .for("update");

    if (!sess) {
      throw new Error("Сессия процедуры не найдена");
    }
    sessionRow = sess;
  }

  return {
    master: masterRow,
    client: clientRow,
    cycle: cycleRow,
    appointment: appointmentRow,
    session: sessionRow,
  };
}
