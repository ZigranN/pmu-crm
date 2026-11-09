"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireBrowserStudioContext } from "@/server/auth/context";
import {
  recordChargeSchema,
  recordPaymentSchema,
  recordRefundSchema,
  recordAdjustmentSchema,
  type RecordChargeInput,
  type RecordPaymentInput,
  type RecordRefundInput,
  type RecordAdjustmentInput,
} from "../schemas/ledger.schema";
import {
  recordCharge,
  recordPayment,
  recordRefund,
  recordAdjustment,
} from "./service";
import { getClientLedgerSummary, getAppointmentLedgerSummary } from "./queries";

export async function recordChargeAction(input: RecordChargeInput) {
  const parsed = recordChargeSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const entry = await recordCharge(db, { studioId: context.studioId, userId: context.userId }, parsed);

  revalidatePath(`/clients/${parsed.clientId}`);
  if (parsed.appointmentId) {
    revalidatePath("/calendar");
  }
  return entry;
}

export async function recordPaymentAction(input: RecordPaymentInput) {
  const parsed = recordPaymentSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const entry = await recordPayment(db, { studioId: context.studioId, userId: context.userId }, parsed);

  revalidatePath(`/clients/${parsed.clientId}`);
  if (parsed.appointmentId) {
    revalidatePath("/calendar");
  }
  return entry;
}

export async function recordRefundAction(input: RecordRefundInput) {
  const parsed = recordRefundSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const entry = await recordRefund(db, { studioId: context.studioId, userId: context.userId }, parsed);

  revalidatePath(`/clients/${parsed.clientId}`);
  if (parsed.appointmentId) {
    revalidatePath("/calendar");
  }
  return entry;
}

export async function recordAdjustmentAction(input: RecordAdjustmentInput) {
  const parsed = recordAdjustmentSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const entry = await recordAdjustment(db, { studioId: context.studioId, userId: context.userId }, parsed);

  revalidatePath(`/clients/${parsed.clientId}`);
  if (parsed.appointmentId) {
    revalidatePath("/calendar");
  }
  return entry;
}

export async function getClientFinancialSummaryAction(clientId: string) {
  const context = await requireBrowserStudioContext();
  return getClientLedgerSummary(clientId, context.studioId);
}

export async function getAppointmentFinancialSummaryAction(appointmentId: string) {
  const context = await requireBrowserStudioContext();
  return getAppointmentLedgerSummary(appointmentId, context.studioId);
}
