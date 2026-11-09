import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ledgerEntries,
  clients,
  appointments,
  treatmentCycles,
} from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getStudioRole } from "@/lib/roles";
import { canonicalClientId } from "@/features/clients/server/identity";
import { lockStudioAccess } from "@/server/auth/scopes";
import { writeAudit } from "@/server/services/audit-log.service";
import type { Transaction } from "@/server/commands/ownership";
import { calculateLedgerBalance } from "../domain/balance";
import type { FinancialSummary, LedgerEntryRecord } from "../domain/types";
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

export type LedgerContext = {
  studioId: string;
  userId: string;
};

async function executeInTransaction<T>(
  dbExecutor: typeof db | Transaction,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  if ("transaction" in dbExecutor && typeof dbExecutor.transaction === "function") {
    return (dbExecutor as typeof db).transaction(fn);
  }
  return fn(dbExecutor as Transaction);
}

/**
 * Record a financial CHARGE (obligation) on the immutable ledger.
 */
export async function recordCharge(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  input: RecordChargeInput
): Promise<typeof ledgerEntries.$inferSelect> {
  const parsed = recordChargeSchema.parse(input);
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role === "CLIENT") throw new Error("Permission denied");

    const canCreate =
      role === "OWNER" ||
      role === "ADMIN" ||
      (await hasPermission(tx, context.userId, context.studioId, "APPOINTMENT_CREATE")) ||
      (await hasPermission(tx, context.userId, context.studioId, "PAYMENT_MARK_DEPOSIT"));

    if (!canCreate) {
      throw new Error("Permission denied: cannot create charges");
    }

    const resolvedClientId = await canonicalClientId(parsed.clientId, context.studioId, tx);

    // Lock client row for update
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, resolvedClientId), eq(clients.studioId, context.studioId), isNull(clients.deletedAt)))
      .for("update");

    if (!client) {
      throw new Error("Client not found in this studio");
    }

    if (parsed.appointmentId) {
      const [appt] = await tx
        .select({ id: appointments.id, clientId: appointments.clientId })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, parsed.appointmentId),
            eq(appointments.studioId, context.studioId),
            isNull(appointments.deletedAt)
          )
        );
      if (!appt) throw new Error("Appointment not found in this studio");
    }

    if (parsed.cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.cycleId),
            eq(treatmentCycles.studioId, context.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );
      if (!cycle) throw new Error("Treatment cycle not found in this studio");
    }

    // Idempotency check
    if (parsed.idempotencyKey) {
      const commandId = parsed.idempotencyKey;
      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.commandId, commandId)));

      if (existing) {
        if (
          existing.type !== "CHARGE" ||
          existing.clientId !== resolvedClientId ||
          existing.amountMinor !== parsed.amountMinor ||
          existing.currency !== parsed.currency
        ) {
          throw new Error("Idempotency key payload mismatch");
        }
        return existing;
      }
    }

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        appointmentId: parsed.appointmentId ?? null,
        cycleId: parsed.cycleId ?? null,
        type: "CHARGE",
        amountMinor: parsed.amountMinor,
        currency: parsed.currency ?? "EUR",
        reason: parsed.reason,
        commandId: parsed.idempotencyKey ?? null,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "charge_recorded",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: null,
      after: { ...entry },
      reason: parsed.reason,
      reasonSource: "command",
      metadata: { commandId: parsed.idempotencyKey },
    });

    return entry;
  });
}

/**
 * Record a client PAYMENT on the immutable ledger.
 */
export async function recordPayment(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  input: RecordPaymentInput
): Promise<typeof ledgerEntries.$inferSelect> {
  const parsed = recordPaymentSchema.parse(input);
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role === "CLIENT") throw new Error("Permission denied");

    const canPay =
      role === "OWNER" ||
      role === "ADMIN" ||
      (await hasPermission(tx, context.userId, context.studioId, "PAYMENT_MARK_DEPOSIT"));

    if (!canPay) {
      throw new Error("Permission denied: cannot record payments");
    }

    const resolvedClientId = await canonicalClientId(parsed.clientId, context.studioId, tx);

    // Lock client row for update
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, resolvedClientId), eq(clients.studioId, context.studioId), isNull(clients.deletedAt)))
      .for("update");

    if (!client) {
      throw new Error("Client not found in this studio");
    }

    if (parsed.appointmentId) {
      const [appt] = await tx
        .select({ id: appointments.id, clientId: appointments.clientId })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, parsed.appointmentId),
            eq(appointments.studioId, context.studioId),
            isNull(appointments.deletedAt)
          )
        );
      if (!appt) throw new Error("Appointment not found in this studio");
    }

    if (parsed.cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.cycleId),
            eq(treatmentCycles.studioId, context.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );
      if (!cycle) throw new Error("Treatment cycle not found in this studio");
    }

    // Idempotency check
    if (parsed.idempotencyKey) {
      const commandId = parsed.idempotencyKey;
      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.commandId, commandId)));

      if (existing) {
        if (
          existing.type !== "PAYMENT" ||
          existing.clientId !== resolvedClientId ||
          existing.amountMinor !== parsed.amountMinor ||
          existing.currency !== parsed.currency
        ) {
          throw new Error("Idempotency key payload mismatch");
        }
        return existing;
      }
    }

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        appointmentId: parsed.appointmentId ?? null,
        cycleId: parsed.cycleId ?? null,
        type: "PAYMENT",
        amountMinor: parsed.amountMinor,
        currency: parsed.currency ?? "EUR",
        paymentMethod: parsed.paymentMethod ?? "cash",
        reason: parsed.reason,
        commandId: parsed.idempotencyKey ?? null,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "payment_recorded",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: null,
      after: { ...entry },
      reason: parsed.reason,
      reasonSource: "user",
      metadata: { commandId: parsed.idempotencyKey },
    });

    return entry;
  });
}

/**
 * Record a REFUND on the immutable ledger.
 * Concurrency-safe against over-refund races via PostgreSQL transactional FOR UPDATE locks.
 */
export async function recordRefund(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  input: RecordRefundInput
): Promise<typeof ledgerEntries.$inferSelect> {
  const parsed = recordRefundSchema.parse(input);
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role === "CLIENT" || role === "MASTER") {
      throw new Error("Permission denied: cannot record refunds");
    }

    const canRefund =
      role === "OWNER" ||
      (await hasPermission(tx, context.userId, context.studioId, "PAYMENT_REFUND"));

    if (!canRefund) {
      throw new Error("Permission denied: cannot record refunds");
    }

    const resolvedClientId = await canonicalClientId(parsed.clientId, context.studioId, tx);

    // Lock client row for update to serialize all financial modifications for this client
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, resolvedClientId), eq(clients.studioId, context.studioId), isNull(clients.deletedAt)))
      .for("update");

    if (!client) {
      throw new Error("Client not found in this studio");
    }

    // Idempotency check before refundable calculation
    if (parsed.idempotencyKey) {
      const commandId = parsed.idempotencyKey;
      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.commandId, commandId)));

      if (existing) {
        if (
          existing.type !== "REFUND" ||
          existing.clientId !== resolvedClientId ||
          existing.amountMinor !== parsed.amountMinor ||
          existing.currency !== parsed.currency ||
          (parsed.targetPaymentId && existing.targetPaymentId !== parsed.targetPaymentId)
        ) {
          throw new Error("Idempotency key payload mismatch");
        }
        return existing;
      }
    }

    let appointmentId = parsed.appointmentId ?? null;
    let cycleId: string | null = null;

    if (parsed.targetPaymentId) {
      // Lock target payment entry
      const [targetPayment] = await tx
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.id, parsed.targetPaymentId),
            eq(ledgerEntries.studioId, context.studioId),
            eq(ledgerEntries.clientId, resolvedClientId)
          )
        )
        .for("update");

      if (!targetPayment) {
        throw new Error("Target payment entry not found for this client");
      }

      if (targetPayment.type !== "PAYMENT") {
        throw new Error("Target entry is not a payment");
      }

      appointmentId = appointmentId ?? targetPayment.appointmentId ?? null;
      cycleId = targetPayment.cycleId ?? null;

      // Calculate total existing refunds against this specific payment entry
      const existingRefunds = await tx
        .select({
          totalRefunded: sql<number>`coalesce(sum(${ledgerEntries.amountMinor}), 0)::int`,
        })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.studioId, context.studioId),
            eq(ledgerEntries.targetPaymentId, targetPayment.id),
            eq(ledgerEntries.type, "REFUND")
          )
        );

      const alreadyRefunded = existingRefunds[0]?.totalRefunded ?? 0;
      const remainingRefundable = targetPayment.amountMinor - alreadyRefunded;

      if (parsed.amountMinor > remainingRefundable) {
        throw new Error(
          `Over-refund rejected: refundable balance is €${(remainingRefundable / 100).toFixed(2)}, requested €${(parsed.amountMinor / 100).toFixed(2)}`
        );
      }
    } else {
      // General client/appointment level refund: verify total paid vs total refunded
      const allEntries = await tx
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.studioId, context.studioId),
            eq(ledgerEntries.clientId, resolvedClientId),
            appointmentId ? eq(ledgerEntries.appointmentId, appointmentId) : undefined
          )
        );

      const summary = calculateLedgerBalance(allEntries as LedgerEntryRecord[]);
      if (parsed.amountMinor > summary.netPaid) {
        throw new Error(
          `Over-refund rejected: net paid amount is €${(summary.netPaid / 100).toFixed(2)}, requested €${(parsed.amountMinor / 100).toFixed(2)}`
        );
      }
    }

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        appointmentId,
        cycleId,
        type: "REFUND",
        amountMinor: parsed.amountMinor,
        currency: parsed.currency ?? "EUR",
        targetPaymentId: parsed.targetPaymentId ?? null,
        reason: parsed.reason,
        commandId: parsed.idempotencyKey ?? null,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "refund_recorded",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: null,
      after: { ...entry },
      reason: parsed.reason,
      reasonSource: "user",
      metadata: { commandId: parsed.idempotencyKey, targetPaymentId: parsed.targetPaymentId },
    });

    return entry;
  });
}

/**
 * Record a financial ADJUSTMENT on the immutable ledger.
 * Allowed only for authorized staff (OWNER / authorized ADMIN).
 */
export async function recordAdjustment(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  input: RecordAdjustmentInput
): Promise<typeof ledgerEntries.$inferSelect> {
  const parsed = recordAdjustmentSchema.parse(input);
  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const role = await getStudioRole(tx, context.userId, context.studioId);
    if (role !== "OWNER" && role !== "ADMIN") {
      throw new Error("Permission denied: financial adjustments require studio administrator or owner authority");
    }

    const resolvedClientId = await canonicalClientId(parsed.clientId, context.studioId, tx);

    // Lock client row for update
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, resolvedClientId), eq(clients.studioId, context.studioId), isNull(clients.deletedAt)))
      .for("update");

    if (!client) {
      throw new Error("Client not found in this studio");
    }

    if (parsed.appointmentId) {
      const [appt] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, parsed.appointmentId),
            eq(appointments.studioId, context.studioId),
            isNull(appointments.deletedAt)
          )
        );
      if (!appt) throw new Error("Appointment not found in this studio");
    }

    if (parsed.cycleId) {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.cycleId),
            eq(treatmentCycles.studioId, context.studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );
      if (!cycle) throw new Error("Treatment cycle not found in this studio");
    }

    // Idempotency check
    if (parsed.idempotencyKey) {
      const commandId = parsed.idempotencyKey;
      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.commandId, commandId)));

      if (existing) {
        if (
          existing.type !== "ADJUSTMENT" ||
          existing.clientId !== resolvedClientId ||
          existing.amountMinor !== parsed.amountMinor ||
          existing.currency !== parsed.currency
        ) {
          throw new Error("Idempotency key payload mismatch");
        }
        return existing;
      }
    }

    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        studioId: context.studioId,
        clientId: resolvedClientId,
        appointmentId: parsed.appointmentId ?? null,
        cycleId: parsed.cycleId ?? null,
        type: "ADJUSTMENT",
        amountMinor: parsed.amountMinor,
        currency: parsed.currency ?? "EUR",
        reason: parsed.reason,
        commandId: parsed.idempotencyKey ?? null,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "ledger_adjustment_recorded",
      entityType: "ledger_entry",
      entityId: entry.id,
      before: null,
      after: { ...entry },
      reason: parsed.reason,
      reasonSource: "user",
      metadata: { commandId: parsed.idempotencyKey },
    });

    return entry;
  });
}

/**
 * Fetch deterministic list of ledger entries for a client, studio, or appointment.
 */
export async function listLedgerEntries(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  filter: {
    clientId?: string;
    appointmentId?: string;
    cycleId?: string;
    type?: "CHARGE" | "PAYMENT" | "REFUND" | "ADJUSTMENT";
  }
): Promise<(typeof ledgerEntries.$inferSelect)[]> {
  const conditions = [eq(ledgerEntries.studioId, context.studioId)];

  if (filter.clientId) {
    const resolvedClientId = await canonicalClientId(filter.clientId, context.studioId, dbExecutor);
    conditions.push(eq(ledgerEntries.clientId, resolvedClientId));
  }

  if (filter.appointmentId) {
    conditions.push(eq(ledgerEntries.appointmentId, filter.appointmentId));
  }

  if (filter.cycleId) {
    conditions.push(eq(ledgerEntries.cycleId, filter.cycleId));
  }

  if (filter.type) {
    conditions.push(eq(ledgerEntries.type, filter.type));
  }

  return dbExecutor
    .select()
    .from(ledgerEntries)
    .where(and(...conditions))
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));
}

/**
 * Get client financial summary derived from immutable ledger entries.
 */
export async function getClientFinancialSummary(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  clientId: string
): Promise<{
  summary: FinancialSummary;
  entries: (typeof ledgerEntries.$inferSelect)[];
}> {
  const resolvedClientId = await canonicalClientId(clientId, context.studioId, dbExecutor);

  const entries = await dbExecutor
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.clientId, resolvedClientId)))
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

  const summary = calculateLedgerBalance(entries as LedgerEntryRecord[]);

  return { summary, entries };
}

/**
 * Get appointment financial summary derived from immutable ledger entries.
 */
export async function getAppointmentFinancialSummary(
  dbExecutor: typeof db | Transaction,
  context: LedgerContext,
  appointmentId: string
): Promise<{
  summary: FinancialSummary;
  entries: (typeof ledgerEntries.$inferSelect)[];
  expectedPriceCents: number;
  paidAmountCents: number;
  outstandingAmountCents: number;
}> {
  const [appt] = await dbExecutor
    .select({
      id: appointments.id,
      priceSnapshotCents: appointments.priceSnapshotCents,
      status: appointments.status,
    })
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.studioId, context.studioId)));

  if (!appt) {
    throw new Error("Appointment not found");
  }

  const entries = await dbExecutor
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.studioId, context.studioId), eq(ledgerEntries.appointmentId, appointmentId)))
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

  const summary = calculateLedgerBalance(entries as LedgerEntryRecord[]);

  const effectiveCharges = summary.totalCharges > 0 ? summary.totalCharges : appt.priceSnapshotCents;
  const netCharges = effectiveCharges + summary.totalAdjustments;
  const outstandingAmountCents = Math.max(0, netCharges - summary.netPaid);

  return {
    summary: {
      ...summary,
      totalCharges: effectiveCharges,
      netCharges,
      outstanding: outstandingAmountCents,
      credit: Math.max(0, summary.netPaid - netCharges),
      balance: netCharges - summary.netPaid,
    },
    entries,
    expectedPriceCents: appt.priceSnapshotCents,
    paidAmountCents: summary.netPaid,
    outstandingAmountCents,
  };
}
