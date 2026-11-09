import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  appointmentCycles,
  appointments,
  cycleCommercialTerms,
  ledgerEntries,
  masters,
  procedureSessions,
  treatmentCycles,
  treatmentPackages,
} from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";
import { resolveEffectiveMedicalEligibility } from "@/features/medical/server/eligibility";
import { resolveEffectiveConsent } from "@/features/consent/server/coverage";
import { evaluateCycleReadiness, evaluatePackageReadiness } from "../domain/readiness";
import { calculatePackageFinancialSummary } from "../domain/financial";
import type {
  CycleReadinessSummary,
  PackageFinancialSummary,
  PackageReadinessAggregate,
  TotalFacePackageStatus,
} from "../domain/types";
import { STAGE_LABELS, type CycleStage } from "@/features/treatment-cycles/stages";

export async function getClientPackages(clientId: string): Promise<PackageReadinessAggregate[]> {
  return sensitiveRead(
    "CLIENT_READ",
    undefined,
    { operation: "packages.list", targetId: clientId },
    async (context) => {
      const packages = await db
        .select()
        .from(treatmentPackages)
        .where(
          and(
            eq(treatmentPackages.clientId, clientId),
            eq(treatmentPackages.studioId, context.studioId)
          )
        )
        .orderBy(desc(treatmentPackages.createdAt));

      const result: PackageReadinessAggregate[] = [];
      for (const pkg of packages) {
        const aggregate = await buildPackageReadinessAggregate(context, pkg);
        result.push(aggregate);
      }
      return result;
    },
    (items) => items.map((i) => i.packageId)
  );
}

export async function getPackageById(packageId: string): Promise<PackageReadinessAggregate | null> {
  return sensitiveRead(
    "CLIENT_READ",
    undefined,
    { operation: "package.read", targetId: packageId },
    async (context) => {
      const [pkg] = await db
        .select()
        .from(treatmentPackages)
        .where(
          and(
            eq(treatmentPackages.id, packageId),
            eq(treatmentPackages.studioId, context.studioId)
          )
        );

      if (!pkg) return null;
      return buildPackageReadinessAggregate(context, pkg);
    },
    (item) => (item ? [item.packageId] : [])
  );
}

async function buildPackageReadinessAggregate(
  context: { studioId: string; userId: string },
  pkg: typeof treatmentPackages.$inferSelect
): Promise<PackageReadinessAggregate> {
  // 1. Fetch sibling cycles
  const cycles = await db
    .select()
    .from(treatmentCycles)
    .where(
      and(
        eq(treatmentCycles.packageId, pkg.id),
        eq(treatmentCycles.studioId, context.studioId)
      )
    )
    .orderBy(asc(treatmentCycles.createdAt));

  const cycleSummaries: CycleReadinessSummary[] = [];
  const cycleFinancialInputs: Array<{
    cycleId: string;
    zoneCode: string;
    expectedPriceCents: number;
    appointmentIds: string[];
  }> = [];

  const allCycleApptIds: string[] = [];

  for (const cycle of cycles) {
    // Medical & Consent
    const medical = await resolveEffectiveMedicalEligibility(
      { studioId: context.studioId, userId: context.userId },
      cycle.id
    );
    const consent = await resolveEffectiveConsent(
      { studioId: context.studioId, userId: context.userId },
      cycle.id
    );

    // Next upcoming appointment
    const cycleApptRows = await db
      .select({
        appointmentId: appointmentCycles.appointmentId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        masterId: appointments.masterId,
      })
      .from(appointmentCycles)
      .innerJoin(appointments, eq(appointmentCycles.appointmentId, appointments.id))
      .where(
        and(
          eq(appointmentCycles.cycleId, cycle.id),
          eq(appointmentCycles.studioId, context.studioId),
          inArray(appointments.status, ["confirmed", "completed"])
        )
      )
      .orderBy(asc(appointments.startAt));

    const apptIds = cycleApptRows.map((r) => r.appointmentId);
    allCycleApptIds.push(...apptIds);

    const upcomingAppt = cycleApptRows.find((r) =>
      ["confirmed"].includes(r.status)
    ) || cycleApptRows.at(-1);

    let masterName: string | undefined = undefined;
    if (upcomingAppt?.masterId) {
      const [m] = await db
        .select({ displayName: masters.displayName })
        .from(masters)
        .where(eq(masters.id, upcomingAppt.masterId));
      masterName = m?.displayName;
    }

    // Procedures
    const sessions = await db
      .select()
      .from(procedureSessions)
      .where(
        and(
          eq(procedureSessions.cycleId, cycle.id),
          eq(procedureSessions.studioId, context.studioId)
        )
      );

    const activeSession = sessions.find((s) => s.status === "IN_PROGRESS");
    const completedSessions = sessions.filter((s) => s.status === "COMPLETED");

    // Commercial Terms / Price
    const [terms] = await db
      .select()
      .from(cycleCommercialTerms)
      .where(
        and(
          eq(cycleCommercialTerms.cycleId, cycle.id),
          eq(cycleCommercialTerms.studioId, context.studioId)
        )
      )
      .orderBy(desc(cycleCommercialTerms.confirmedAt))
      .limit(1);

    const expectedPriceCents = terms?.amountCents ?? 0;

    cycleFinancialInputs.push({
      cycleId: cycle.id,
      zoneCode: cycle.zoneCode,
      expectedPriceCents,
      appointmentIds: apptIds,
    });

    const cycleSummary = evaluateCycleReadiness({
      cycleId: cycle.id,
      zoneCode: cycle.zoneCode,
      kind: cycle.kind,
      stage: cycle.stage,
      stageTitle: STAGE_LABELS[cycle.stage as CycleStage] ?? cycle.stage,
      medicalStatus: medical.status,
      medicalReasonCode: medical.reasonCode,
      consentStatus: consent.status,
      nextAppointment: upcomingAppt
        ? {
            id: upcomingAppt.appointmentId,
            startAt: new Date(upcomingAppt.startAt).toISOString(),
            endAt: new Date(upcomingAppt.endAt).toISOString(),
            status: upcomingAppt.status,
            masterName,
          }
        : null,
      activeSessionId: activeSession?.id ?? null,
      completedProceduresCount: completedSessions.length,
      expectedPriceCents,
      paidCents: 0, // Will be filled after financial summary
    });

    cycleSummaries.push(cycleSummary);
  }

  // Fetch ledger entries for client or cycle appointments
  let rawLedgerEntries: Array<{
    id: string;
    appointmentId: string | null;
    cycleId: string | null;
    entryType: string;
    amountMinor: number;
  }> = [];

  if (allCycleApptIds.length > 0) {
    rawLedgerEntries = await db
      .select({
        id: ledgerEntries.id,
        appointmentId: ledgerEntries.appointmentId,
        cycleId: ledgerEntries.cycleId,
        entryType: ledgerEntries.type,
        amountMinor: ledgerEntries.amountMinor,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.studioId, context.studioId),
          inArray(ledgerEntries.appointmentId, allCycleApptIds)
        )
      );
  }

  const financialSummary: PackageFinancialSummary = calculatePackageFinancialSummary(
    cycleFinancialInputs,
    rawLedgerEntries
  );

  // Update cycle summaries with attributed paidCents
  for (const cs of cycleSummaries) {
    const fin = financialSummary.cycleBreakdown.find((b) => b.cycleId === cs.cycleId);
    if (fin) {
      cs.financial.paidCents = fin.paidCents;
      cs.financial.outstandingCents = fin.outstandingCents;
    }
  }

  return evaluatePackageReadiness({
    packageId: pkg.id,
    clientId: pkg.clientId,
    status: pkg.status as TotalFacePackageStatus,
    cycles: cycleSummaries,
    financialSummary,
  });
}
