import "server-only";
import { sensitiveRead, recordIds } from "@/server/services/access-log.service";
import { db } from "@/db";
import { ledgerEntries, clients, appointments, studios } from "@/db/schema";
import { and, asc, eq, isNull, sql, gte, lte } from "drizzle-orm";
import { requireAuthenticatedUser, requireStudioPermissionFor } from "@/server/auth/context";
import { resourceScope } from "@/server/auth/scopes";
import { canonicalClientId } from "@/features/clients/server/identity";
import { calculateLedgerBalance } from "../domain/balance";
import { calculateDailyPaymentReport, type DailyPaymentReportSummary } from "../domain/daily-report";
import type { LedgerEntryRecord } from "../domain/types";
import { getDayBoundsInUtc, formatUtcToLocal } from "@/features/calendar/domain/timezone";

async function ledgerVisibility(clientId: string, studioId: string) {
  const user = await requireAuthenticatedUser();
  const context = await requireStudioPermissionFor(user.id, studioId, "PAYMENT_READ");
  const resolvedClientId = await canonicalClientId(clientId, studioId);
  const scope = await resourceScope(context);

  const ownAppointment = sql`exists (select 1 from appointments pa where pa.id = ${ledgerEntries.appointmentId}
    and pa.studio_id = ${studioId} and pa.client_id = ${resolvedClientId} and pa.deleted_at is null and ${scope.ownsMaster(sql`pa.master_id`)})`;

  return and(
    eq(ledgerEntries.clientId, resolvedClientId),
    eq(ledgerEntries.studioId, studioId),
    isNull(clients.deletedAt),
    scope.client,
    scope.isMaster
      ? sql`(${ledgerEntries.appointmentId} is not null and ${ownAppointment})`
      : undefined
  );
}

export async function getClientLedgerSummary(clientId: string, studioId: string) {
  return sensitiveRead(
    "PAYMENT_READ",
    studioId,
    { operation: "finance.summary", targetId: clientId },
    async () => {
      const visible = await ledgerVisibility(clientId, studioId);
      const resolvedClientId = await canonicalClientId(clientId, studioId);

      const rows = await db
        .select({ entry: ledgerEntries })
        .from(ledgerEntries)
        .innerJoin(
          clients,
          and(eq(clients.id, ledgerEntries.clientId), eq(clients.studioId, ledgerEntries.studioId))
        )
        .where(visible)
        .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

      const entries = rows.map((r) => r.entry);
      const summary = calculateLedgerBalance(entries as LedgerEntryRecord[]);

      return { summary, entries, clientId: resolvedClientId };
    },
    (res) => res.entries.map((e) => e.id)
  );
}

export async function getAppointmentLedgerSummary(appointmentId: string, studioId: string) {
  return sensitiveRead(
    "PAYMENT_READ",
    studioId,
    { operation: "finance.summary", targetId: appointmentId },
    async (context) => {
      const user = await requireAuthenticatedUser();
      const permContext = await requireStudioPermissionFor(user.id, studioId, "PAYMENT_READ");
      const scope = await resourceScope(permContext);

      const [appt] = await db
        .select({
          id: appointments.id,
          clientId: appointments.clientId,
          masterId: appointments.masterId,
          priceSnapshotCents: appointments.priceSnapshotCents,
          status: appointments.status,
        })
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.studioId, studioId), isNull(appointments.deletedAt)));

      if (!appt) {
        throw new Error("Appointment not found");
      }

      if (scope.isMaster && appt.masterId !== context.userId) {
        // Check if master row belongs to this user
        const owns = await db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.id, appointmentId),
              eq(appointments.studioId, studioId),
              scope.ownsMaster(sql`${appointments.masterId}`)
            )
          );
        if (!owns.length) {
          throw new Error("Permission denied: cannot access another master's appointment financial summary");
        }
      }

      const rows = await db
        .select({ entry: ledgerEntries })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.studioId, studioId),
            eq(ledgerEntries.appointmentId, appointmentId)
          )
        )
        .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

      const entries = rows.map((r) => r.entry);
      const summary = calculateLedgerBalance(entries as LedgerEntryRecord[]);

      return {
        summary,
        entries,
        expectedPriceCents: appt.priceSnapshotCents,
        appointmentId: appt.id,
        clientId: appt.clientId,
      };
    },
    (res) => res.entries.map((e) => e.id)
  );
}

export async function listClientLedgerEntries(clientId: string, studioId: string) {
  return sensitiveRead("PAYMENT_READ", studioId, { operation: "ledger.list", targetId: clientId }, async () => {
    const visible = await ledgerVisibility(clientId, studioId);
    const rows = await db
      .select({ entry: ledgerEntries })
      .from(ledgerEntries)
      .innerJoin(
        clients,
        and(eq(clients.id, ledgerEntries.clientId), eq(clients.studioId, ledgerEntries.studioId))
      )
      .where(visible)
      .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

    return rows.map((r) => r.entry);
  }, recordIds);
}

export async function fetchDailyPaymentReportInternal(
  studioId: string,
  targetDate?: Date | string,
  database: typeof db = db
): Promise<DailyPaymentReportSummary> {
  const [studio] = await database
    .select({ timezone: studios.timezone })
    .from(studios)
    .where(eq(studios.id, studioId));
  const tz = studio?.timezone || "Europe/Rome";

  let dateStr: string;
  if (typeof targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    dateStr = targetDate;
  } else {
    const d = targetDate ? new Date(targetDate) : new Date();
    dateStr = formatUtcToLocal(d, tz).dateString;
  }

  const { startOfDay, endOfDay } = getDayBoundsInUtc(dateStr, tz);

  // 1. Fetch entries created on that calendar day within Studio timezone bounds
  const dayRows = await database
    .select({ entry: ledgerEntries })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.studioId, studioId),
        gte(ledgerEntries.createdAt, startOfDay),
        lte(ledgerEntries.createdAt, endOfDay)
      )
    );

  const dayEntries = dayRows.map((r) => r.entry as LedgerEntryRecord);

  // 2. Fetch all studio entries to calculate studio-wide outstanding client balances
  const allStudioRows = await database
    .select({ entry: ledgerEntries })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.studioId, studioId));

  const clientEntriesMap = new Map<string, LedgerEntryRecord[]>();
  for (const row of allStudioRows) {
    const e = row.entry as LedgerEntryRecord;
    const list = clientEntriesMap.get(e.clientId) || [];
    list.push(e);
    clientEntriesMap.set(e.clientId, list);
  }

  const clientBalances: { clientId: string; outstandingMinor: number }[] = [];
  for (const [cId, entries] of clientEntriesMap.entries()) {
    const balance = calculateLedgerBalance(entries);
    if (balance.outstanding > 0) {
      clientBalances.push({ clientId: cId, outstandingMinor: balance.outstanding });
    }
  }

  // 3. Query missing payments: completed appointments with unpaid amounts
  const completedAppts = await database
    .select({
      id: appointments.id,
      clientId: appointments.clientId,
      priceSnapshotCents: appointments.priceSnapshotCents,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.studioId, studioId),
        eq(appointments.status, "completed"),
        isNull(appointments.deletedAt)
      )
    );

  const missingProcedures: { appointmentId: string; clientId: string; missingAmountMinor: number }[] = [];
  for (const appt of completedAppts) {
    const apptEntries = allStudioRows
      .filter((r) => r.entry.appointmentId === appt.id)
      .map((r) => r.entry as LedgerEntryRecord);
    const balance = calculateLedgerBalance(apptEntries);
    const expected = appt.priceSnapshotCents ?? 0;
    const unpaid = Math.max(0, expected - balance.totalPayments + balance.totalRefunds);
    if (unpaid > 0) {
      missingProcedures.push({
        appointmentId: appt.id,
        clientId: appt.clientId,
        missingAmountMinor: unpaid,
      });
    }
  }

  // 4. Query pending acconto: pending appointments awaiting deposit
  // Per Master Specification Sections 22 & 23, PMU and Total Face procedures require €50 acconto.
  const pendingAppts = await database
    .select({
      id: appointments.id,
      clientId: appointments.clientId,
      serviceSnapshot: appointments.serviceSnapshot,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.studioId, studioId),
        eq(appointments.status, "pending"),
        isNull(appointments.deletedAt)
      )
    );

  const pendingAccontos: { appointmentId: string; clientId: string; depositAmountMinor: number }[] = [];
  for (const appt of pendingAppts) {
    const apptEntries = allStudioRows
      .filter((r) => r.entry.appointmentId === appt.id)
      .map((r) => r.entry as LedgerEntryRecord);
    const balance = calculateLedgerBalance(apptEntries);
    if (balance.totalPayments === 0) {
      const snap = (appt.serviceSnapshot as any) || {};
      const cat = (snap.category || snap.categoryCode || "").toLowerCase();
      const isExempt = cat === "remover" || cat === "laminazione" || cat === "skin_experience" || cat === "skin";
      const depositAmount = isExempt ? 0 : 5000;

      if (depositAmount > 0) {
        pendingAccontos.push({
          appointmentId: appt.id,
          clientId: appt.clientId,
          depositAmountMinor: depositAmount,
        });
      }
    }
  }

  return calculateDailyPaymentReport({
    date: dateStr,
    entries: dayEntries,
    clientBalances,
    missingProcedures,
    pendingAccontos,
  });
}

export async function getDailyPaymentReport(
  studioId: string,
  targetDate?: Date | string
): Promise<DailyPaymentReportSummary> {
  return sensitiveRead(
    "PAYMENT_READ",
    studioId,
    { operation: "finance.summary", targetId: studioId },
    async () => {
      const user = await requireAuthenticatedUser();
      await requireStudioPermissionFor(user.id, studioId, "PAYMENT_READ");
      return fetchDailyPaymentReportInternal(studioId, targetDate, db);
    },
    () => []
  );
}
