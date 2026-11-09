"use server";

import { revalidatePath } from "next/cache";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { idempotentCommand, type Json } from "@/server/commands/idempotency";
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
import {
  abortProcedureSession,
  completeProcedureSession,
  startProcedureSession,
  updateProcedureEvidence,
} from "./service";
import { lockProcedureSession, type ProcedureContext } from "./scope";

export async function startProcedureAction(
  rawInput: StartProcedureInput,
  requestKey: string
) {
  const data = START_PROCEDURE_SCHEMA.parse(rawInput);
  const context = (await requireBrowserStudioPermission("PROCEDURE_CREATE")) as unknown as ProcedureContext;

  const result = (await idempotentCommand(
    context,
    "PROCEDURE_CREATE",
    "procedure.start.v1",
    requestKey,
    data as unknown as Record<string, Json>,
    async (tx, commandId) => {
      const session = await startProcedureSession(
        context,
        { ...data, commandId },
        tx
      );
      return { id: session.id, cycleId: session.cycleId, status: session.status };
    },
    async (tx, res) => {
      const typed = res as { id: string };
      await lockProcedureSession(tx, context, typed.id);
    }
  )) as { id: string; cycleId?: string | null; status: string };

  if (data.cycleId) {
    revalidatePath(`/deals/${data.cycleId}`);
  }
  revalidatePath("/deals");
  revalidatePath("/calendar");

  return result;
}

export async function completeProcedureAction(
  rawInput: CompleteProcedureInput,
  requestKey: string
) {
  const data = COMPLETE_PROCEDURE_SCHEMA.parse(rawInput);
  const context = (await requireBrowserStudioPermission("PROCEDURE_UPDATE")) as unknown as ProcedureContext;

  const result = (await idempotentCommand(
    context,
    "PROCEDURE_UPDATE",
    "procedure.complete.v1",
    requestKey,
    data as unknown as Record<string, Json>,
    async (tx, commandId) => {
      const session = await completeProcedureSession(context, { ...data, commandId }, tx);
      return { id: session.id, cycleId: session.cycleId, status: session.status };
    },
    async (tx, res) => {
      const typed = res as { id: string };
      await lockProcedureSession(tx, context, typed.id);
    }
  )) as { id: string; cycleId?: string | null; status: string };

  if (result.cycleId) {
    revalidatePath(`/deals/${result.cycleId}`);
  }
  revalidatePath("/deals");
  revalidatePath("/calendar");

  return result;
}

export async function abortProcedureAction(
  rawInput: AbortProcedureInput,
  requestKey: string
) {
  const data = ABORT_PROCEDURE_SCHEMA.parse(rawInput);
  const context = (await requireBrowserStudioPermission("PROCEDURE_UPDATE")) as unknown as ProcedureContext;

  const result = (await idempotentCommand(
    context,
    "PROCEDURE_UPDATE",
    "procedure.abort.v1",
    requestKey,
    data as unknown as Record<string, Json>,
    async (tx) => {
      const session = await abortProcedureSession(context, data, tx);
      return { id: session.id, cycleId: session.cycleId, status: session.status };
    },
    async (tx, res) => {
      const typed = res as { id: string };
      await lockProcedureSession(tx, context, typed.id);
    }
  )) as { id: string; cycleId?: string | null; status: string };

  if (result.cycleId) {
    revalidatePath(`/deals/${result.cycleId}`);
  }
  revalidatePath("/deals");

  return result;
}

export async function updateProcedureEvidenceAction(
  rawInput: UpdateProcedureEvidenceInput,
  requestKey: string
) {
  const data = UPDATE_PROCEDURE_EVIDENCE_SCHEMA.parse(rawInput);
  const context = (await requireBrowserStudioPermission("PROCEDURE_UPDATE")) as unknown as ProcedureContext;

  const result = (await idempotentCommand(
    context,
    "PROCEDURE_UPDATE",
    "procedure.update_evidence.v1",
    requestKey,
    data as unknown as Record<string, Json>,
    async (tx) => {
      const session = await updateProcedureEvidence(context, data, tx);
      return { id: session.id, cycleId: session.cycleId, status: session.status };
    },
    async (tx, res) => {
      const typed = res as { id: string };
      await lockProcedureSession(tx, context, typed.id);
    }
  )) as { id: string; cycleId?: string | null; status: string };

  if (result.cycleId) {
    revalidatePath(`/deals/${result.cycleId}`);
  }

  return result;
}
