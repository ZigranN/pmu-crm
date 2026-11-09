import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  appointmentCycles,
  appointments,
  clientMedicalProfiles,
  clients,
  consultationResults,
  consultations,
  cycleConsents,
  cycleConsentZones,
  cycleMedicalClearances,
  followUpClosures,
  followUpRevisions,
  ledgerEntries,
  masters,
  medicalProfileRevisions,
  procedureSessions,
  treatmentCycles,
  treatmentPackages,
  handoffs,
  user,
} from "@/db/schema";
import { or } from "drizzle-orm";
import { sensitiveRead } from "@/server/services/access-log.service";
import { evaluateEffectiveMedicalEligibility } from "@/features/medical/domain/effective-eligibility";
import { evaluateEffectiveConsent } from "@/features/consent/domain/effective-consent";
import { evaluateCycleReadiness, evaluatePackageReadiness } from "@/features/packages/domain/readiness";
import { calculatePackageFinancialSummary } from "@/features/packages/domain/financial";
import { calculateLedgerBalance } from "@/features/ledger/domain/balance";
import type { LedgerEntryRecord } from "@/features/ledger/domain/types";
import { STAGE_LABELS, ZONE_LABELS, type CycleStage } from "@/features/treatment-cycles/stages";
import type {
  AttentionFilterOptions,
  AttentionSummaryCounts,
  NeedsAttentionItem,
} from "../domain/types";
import {
  calculateAttentionSummaryCounts,
  deduplicateAttentionItems,
  filterAttentionItems,
  sortAttentionItems,
} from "../domain/evaluator";
import { normalizeRole } from "@/lib/roles";

export async function getNeedsAttention(
  filters?: AttentionFilterOptions
): Promise<NeedsAttentionItem[]> {
  return sensitiveRead(
    "CLIENT_READ",
    undefined,
    { operation: "clients.list" },
    async (context) => {
      const items = await collectAttentionItems(context);
      const deduplicated = deduplicateAttentionItems(items);
      const filtered = filterAttentionItems(deduplicated, filters);
      return sortAttentionItems(filtered);
    },
    (items) => Array.from(new Set(items.map((i) => i.clientId).filter(Boolean)))
  );
}

export async function getNeedsAttentionCount(
  filters?: AttentionFilterOptions
): Promise<AttentionSummaryCounts> {
  const items = await getNeedsAttention(filters);
  return calculateAttentionSummaryCounts(items);
}

export async function collectAttentionItems(context: {
  studioId: string;
  userId: string;
  role?: string;
}): Promise<NeedsAttentionItem[]> {
  const studioId = context.studioId;
  const now = new Date();
  const normalizedUserRole = normalizeRole(context.role ?? "MASTER");

  // Determine master scope if user is MASTER
  let scopedMasterId: string | null = null;
  if (normalizedUserRole === "MASTER") {
    const [masterRow] = await db
      .select({ id: masters.id })
      .from(masters)
      .where(
        and(
          eq(masters.studioId, studioId),
          eq(masters.userId, context.userId),
          isNull(masters.deletedAt)
        )
      );
    scopedMasterId = masterRow?.id ?? null;
  }

  // 1. Fetch Clients
  const clientRows = await db
    .select({
      id: clients.id,
      name: clients.fullName,
      phone: clients.phone,
      createdAt: clients.createdAt,
    })
    .from(clients)
    .where(and(eq(clients.studioId, studioId), isNull(clients.deletedAt)));

  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  // 2. Fetch Masters
  const masterRows = await db
    .select({
      id: masters.id,
      displayName: masters.displayName,
      userId: masters.userId,
    })
    .from(masters)
    .where(and(eq(masters.studioId, studioId), isNull(masters.deletedAt)));

  const masterMap = new Map(masterRows.map((m) => [m.id, m]));

  // 3. Fetch Treatment Cycles
  const cycleRows = await db
    .select()
    .from(treatmentCycles)
    .where(and(eq(treatmentCycles.studioId, studioId), isNull(treatmentCycles.archivedAt)));

  // If MASTER, scope active cycles
  const visibleCycles = scopedMasterId
    ? cycleRows.filter((c) => c.assignedMasterId === scopedMasterId)
    : cycleRows;

  const cycleMap = new Map(cycleRows.map((c) => [c.id, c]));

  // 4. Fetch Appointments
  const apptRows = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.studioId, studioId), isNull(appointments.deletedAt)))
    .orderBy(desc(appointments.startAt));

  // If MASTER, scope appointments
  const visibleAppointments = scopedMasterId
    ? apptRows.filter((a) => a.masterId === scopedMasterId)
    : apptRows;

  // Appointment Cycle links
  const apptCycleRows = await db
    .select()
    .from(appointmentCycles)
    .where(eq(appointmentCycles.studioId, studioId));

  const apptToCycles = new Map<string, string[]>();
  const cycleToAppts = new Map<string, typeof apptRows>();

  for (const ac of apptCycleRows) {
    const list = apptToCycles.get(ac.appointmentId) ?? [];
    list.push(ac.cycleId);
    apptToCycles.set(ac.appointmentId, list);
  }

  for (const a of apptRows) {
    const cycleIds = apptToCycles.get(a.id) ?? [];
    for (const cId of cycleIds) {
      const list = cycleToAppts.get(cId) ?? [];
      list.push(a);
      cycleToAppts.set(cId, list);
    }
  }

  // 5. Fetch Medical Profiles & Clearances
  const clientIds = clientRows.map((c) => c.id);
  const medProfiles =
    clientIds.length > 0
      ? await db
          .select()
          .from(clientMedicalProfiles)
          .where(
            and(
              inArray(clientMedicalProfiles.clientId, clientIds),
              isNull(clientMedicalProfiles.supersededAt)
            )
          )
      : [];
  const medProfileMap = new Map(medProfiles.map((p) => [p.clientId, p]));

  const medRevisions = await db
    .select()
    .from(medicalProfileRevisions)
    .where(eq(medicalProfileRevisions.studioId, studioId))
    .orderBy(desc(medicalProfileRevisions.revisionNumber));

  const latestRevisionByClient = new Map<string, (typeof medRevisions)[0]>();
  for (const rev of medRevisions) {
    if (!latestRevisionByClient.has(rev.clientId)) {
      latestRevisionByClient.set(rev.clientId, rev);
    }
  }

  const clearances = await db
    .select()
    .from(cycleMedicalClearances)
    .where(eq(cycleMedicalClearances.studioId, studioId))
    .orderBy(desc(cycleMedicalClearances.decisionNumber));

  const latestClearanceByCycle = new Map<string, (typeof clearances)[0]>();
  for (const clr of clearances) {
    if (!latestClearanceByCycle.has(clr.cycleId)) {
      latestClearanceByCycle.set(clr.cycleId, clr);
    }
  }

  // 6. Fetch Signed Cycle Consents & Covered Zones
  const consentRows = await db
    .select()
    .from(cycleConsents)
    .where(
      and(
        eq(cycleConsents.studioId, studioId),
        eq(cycleConsents.status, "SIGNED")
      )
    )
    .orderBy(desc(cycleConsents.signedAt), desc(cycleConsents.createdAt));

  const latestConsentByCycle = new Map<string, (typeof consentRows)[0]>();
  for (const cs of consentRows) {
    if (!latestConsentByCycle.has(cs.cycleId)) {
      latestConsentByCycle.set(cs.cycleId, cs);
    }
  }

  const consentZoneRows = await db
    .select()
    .from(cycleConsentZones)
    .where(eq(cycleConsentZones.studioId, studioId));

  const coveredZonesByConsent = new Map<string, string[]>();
  for (const cz of consentZoneRows) {
    const list = coveredZonesByConsent.get(cz.consentId) ?? [];
    list.push(cz.zoneCode);
    coveredZonesByConsent.set(cz.consentId, list);
  }

  // 7. Fetch Packages
  const packageRows = await db
    .select()
    .from(treatmentPackages)
    .where(
      and(
        eq(treatmentPackages.studioId, studioId),
        eq(treatmentPackages.status, "active"),
        isNull(treatmentPackages.archivedAt)
      )
    );

  // 8. Fetch Procedure Sessions
  const sessionRows = await db
    .select()
    .from(procedureSessions)
    .where(eq(procedureSessions.studioId, studioId))
    .orderBy(desc(procedureSessions.createdAt));

  const sessionsByCycle = new Map<string, typeof sessionRows>();
  for (const s of sessionRows) {
    if (s.cycleId) {
      const list = sessionsByCycle.get(s.cycleId) ?? [];
      list.push(s);
      sessionsByCycle.set(s.cycleId, list);
    }
  }

  // 9. Fetch Consultations & Results
  const consultationList = await db
    .select()
    .from(consultations)
    .where(eq(consultations.studioId, studioId))
    .orderBy(desc(consultations.completedAt));

  const consultationResultsList = await db
    .select()
    .from(consultationResults)
    .where(eq(consultationResults.studioId, studioId));

  const resultByConsultation = new Map(
    consultationResultsList.map((r) => [r.consultationId, r])
  );

  const followUpRevisionsList = await db
    .select()
    .from(followUpRevisions)
    .where(eq(followUpRevisions.studioId, studioId))
    .orderBy(desc(followUpRevisions.sequence));

  const closuresList = await db
    .select()
    .from(followUpClosures)
    .where(eq(followUpClosures.studioId, studioId));

  const closedResults = new Set(closuresList.map((c) => c.resultId));

  // 10. Fetch Ledger Entries
  const ledgerRows = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.studioId, studioId))
    .orderBy(desc(ledgerEntries.createdAt));

  const ledgerByClient = new Map<string, LedgerEntryRecord[]>();
  for (const le of ledgerRows) {
    const list = ledgerByClient.get(le.clientId) ?? [];
    list.push(le as LedgerEntryRecord);
    ledgerByClient.set(le.clientId, list);
  }

  const items: NeedsAttentionItem[] = [];

  // ==========================================
  // EVALUATION: Treatment Cycles (Medical, Consent, Scheduling, Stalled)
  // ==========================================
  for (const cycle of visibleCycles) {
    const client = clientMap.get(cycle.clientId);
    const master = cycle.assignedMasterId
      ? masterMap.get(cycle.assignedMasterId)
      : undefined;
    const isTerminal =
      cycle.stage === "cycle_completed" ||
      cycle.stage === "lost" ||
      cycle.stage === "refresh_no_response";

    if (isTerminal) continue;

    const zoneLabel = ZONE_LABELS[cycle.zoneCode] ?? cycle.zoneCode;
    const stageLabel = STAGE_LABELS[cycle.stage as CycleStage] ?? cycle.stage;
    const cycleAppts = cycleToAppts.get(cycle.id) ?? [];
    const futureAppts = cycleAppts.filter(
      (a) =>
        new Date(a.startAt) > now &&
        a.status !== "cancelled" &&
        !a.noShow
    );
    const nextAppt = futureAppts[futureAppts.length - 1] ?? null;

    // --- A. Medical Eligibility ---
    const medProfile = medProfileMap.get(cycle.clientId) ?? null;
    const medRevision = latestRevisionByClient.get(cycle.clientId) ?? null;
    const cycleClearance = latestClearanceByCycle.get(cycle.id) ?? null;

    const medicalEligibility = evaluateEffectiveMedicalEligibility({
      cycleId: cycle.id,
      clientId: cycle.clientId,
      cycleStage: cycle.stage,
      currentMedicalProfile: medProfile,
      currentMedicalRevision: medRevision,
      latestCycleMedicalClearance: cycleClearance,
      mergeReviewRequired: medProfile?.mergeReviewRequired ?? false,
    });

    if (medicalEligibility.status === "REVIEW_REQUIRED") {
      items.push({
        id: `TREATMENT_CYCLE:${cycle.id}:MEDICAL_REVIEW_REQUIRED`,
        attentionRequired: true,
        severity: "HIGH",
        reasonCode: "MEDICAL_REVIEW_REQUIRED",
        title: `Проверка мед. профиля (${zoneLabel})`,
        description: `Медицинский профиль клиента обновлен или требует пересмотра допуска для зоны «${zoneLabel}».`,
        entityType: "TREATMENT_CYCLE",
        entityId: cycle.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        zoneCode: cycle.zoneCode,
        masterId: cycle.assignedMasterId ?? undefined,
        masterName: master?.displayName,
        createdAt: cycle.createdAt,
        suggestedAction: "Рассмотреть медицинский профиль",
        actionUrl: `/clients/${cycle.clientId}`,
        metadata: { medicalStatus: medicalEligibility.status, reason: (medicalEligibility as any).reason },
      });
    } else if (
      medicalEligibility.status === "NOT_CLEARED" ||
      medicalEligibility.status === "CONSULTATION_REQUIRED"
    ) {
      items.push({
        id: `TREATMENT_CYCLE:${cycle.id}:MEDICAL_NOT_CLEARED`,
        attentionRequired: true,
        severity: "CRITICAL",
        reasonCode: "MEDICAL_NOT_CLEARED",
        title: `Медицинский допуск не выдан (${zoneLabel})`,
        description: `Процедура заблокирована по медицинским противопоказаниям или требует очной консультации (статус: ${medicalEligibility.status}).`,
        entityType: "TREATMENT_CYCLE",
        entityId: cycle.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        zoneCode: cycle.zoneCode,
        masterId: cycle.assignedMasterId ?? undefined,
        masterName: master?.displayName,
        createdAt: cycle.createdAt,
        suggestedAction: "Оформить медицинский допуск или консультацию",
        actionUrl: `/clients/${cycle.clientId}`,
        metadata: { medicalStatus: medicalEligibility.status, reason: (medicalEligibility as any).reason },
      });
    }

    // --- B. Consent Coverage ---
    const latestConsent = latestConsentByCycle.get(cycle.id) ?? null;
    const coveredZones = latestConsent
      ? (coveredZonesByConsent.get(latestConsent.id) ?? [])
      : [];

    const effectiveConsent = evaluateEffectiveConsent({
      cycleId: cycle.id,
      clientId: cycle.clientId,
      cycleStage: cycle.stage,
      cycleZoneCode: cycle.zoneCode,
      latestCycleConsent: latestConsent,
      coveredZoneCodes: coveredZones,
    });

    if (effectiveConsent.status === "CONSENT_REQUIRED") {
      const isMissing = effectiveConsent.reason === "NO_SIGNED_CONSENT";
      items.push({
        id: `TREATMENT_CYCLE:${cycle.id}:${isMissing ? "CONSENT_MISSING" : "CONSENT_INVALID"}`,
        attentionRequired: true,
        severity: "HIGH",
        reasonCode: isMissing ? "CONSENT_MISSING" : "CONSENT_INVALID",
        title: isMissing
          ? `Отсутствует согласие (${zoneLabel})`
          : `Недействительное согласие (${zoneLabel})`,
        description: isMissing
          ? `Для этапа «${stageLabel}» требуется подписанное информированное согласие на зону «${zoneLabel}».`
          : `Существующее согласие не покрывает зону «${zoneLabel}» или требует переподписания (${effectiveConsent.reason}).`,
        entityType: "TREATMENT_CYCLE",
        entityId: cycle.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        zoneCode: cycle.zoneCode,
        masterId: cycle.assignedMasterId ?? undefined,
        masterName: master?.displayName,
        createdAt: cycle.createdAt,
        suggestedAction: isMissing ? "Запросить согласие" : "Переподписать согласие",
        actionUrl: `/deals/${cycle.id}`,
        metadata: { consentStatus: effectiveConsent.status, reason: effectiveConsent.reason },
      });
    }

    // --- C. Appointment Missing ---
    const schedulingExpectedStages = [
      "consultation_needed",
      "consultation_offered",
      "procedure_slot_selected",
      "awaiting_acconto",
      "second_session_scheduled",
      "control_scheduled",
    ];

    if (schedulingExpectedStages.includes(cycle.stage) && !nextAppt) {
      items.push({
        id: `TREATMENT_CYCLE:${cycle.id}:APPOINTMENT_MISSING`,
        attentionRequired: true,
        severity: "MEDIUM",
        reasonCode: "APPOINTMENT_MISSING",
        title: `Требуется запись на прием (${zoneLabel})`,
        description: `Сделка находится на этапе «${stageLabel}», но предстоящий визит не назначен в календаре.`,
        entityType: "TREATMENT_CYCLE",
        entityId: cycle.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        zoneCode: cycle.zoneCode,
        masterId: cycle.assignedMasterId ?? undefined,
        masterName: master?.displayName,
        createdAt: cycle.createdAt,
        suggestedAction: "Записать на прием в календаре",
        actionUrl: `/deals/${cycle.id}`,
        metadata: { stage: cycle.stage },
      });
    }

    // --- D. Remover Follow-up Required ---
    if (cycle.kind === "remover") {
      const cycleSessions = sessionsByCycle.get(cycle.id) ?? [];
      const completedSessions = cycleSessions.filter((s) => s.status === "COMPLETED");
      if (completedSessions.length > 0 && !nextAppt) {
        items.push({
          id: `TREATMENT_CYCLE:${cycle.id}:REMOVER_FOLLOW_UP_REQUIRED`,
          attentionRequired: true,
          severity: "MEDIUM",
          reasonCode: "REMOVER_FOLLOW_UP_REQUIRED",
          title: `Требуется повторный визит ремувера (${zoneLabel})`,
          description: `Предыдущий сеанс удаления завершен (${completedSessions.length} сеанс.), следующий визит не запланирован.`,
          entityType: "TREATMENT_CYCLE",
          entityId: cycle.id,
          clientId: cycle.clientId,
          clientName: client?.name,
          clientPhone: client?.phone ?? undefined,
          cycleId: cycle.id,
          zoneCode: cycle.zoneCode,
          masterId: cycle.assignedMasterId ?? undefined,
          masterName: master?.displayName,
          createdAt: cycle.updatedAt,
          suggestedAction: "Назначить следующий сеанс ремувера",
          actionUrl: `/deals/${cycle.id}`,
          metadata: { completedSessionsCount: completedSessions.length },
        });
      }
    }

    // --- E. Stalled Cycle ---
    const daysSinceUpdate =
      (now.getTime() - new Date(cycle.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate >= 14 && !nextAppt) {
      items.push({
        id: `TREATMENT_CYCLE:${cycle.id}:CYCLE_STALLED`,
        attentionRequired: true,
        severity: "LOW",
        reasonCode: "CYCLE_STALLED",
        title: `Сделка без движения (${zoneLabel})`,
        description: `Нет активности по сделке «${stageLabel}» более ${Math.floor(daysSinceUpdate)} дней.`,
        entityType: "TREATMENT_CYCLE",
        entityId: cycle.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        zoneCode: cycle.zoneCode,
        masterId: cycle.assignedMasterId ?? undefined,
        masterName: master?.displayName,
        createdAt: cycle.updatedAt,
        suggestedAction: "Проверить статус сделки или связаться с клиентом",
        actionUrl: `/deals/${cycle.id}`,
        metadata: { daysInactive: Math.floor(daysSinceUpdate) },
      });
    }
  }

  // ==========================================
  // EVALUATION: Appointments (Past Due, Cancelled)
  // ==========================================
  for (const appt of visibleAppointments) {
    const client = clientMap.get(appt.clientId);
    const master = masterMap.get(appt.masterId);
    const linkedCycleIds = apptToCycles.get(appt.id) ?? [];
    const firstCycleId = linkedCycleIds[0];

    // Past due appointment
    if (
      (appt.status === "pending" || appt.status === "confirmed") &&
      new Date(appt.endAt).getTime() < now.getTime()
    ) {
      items.push({
        id: `APPOINTMENT:${appt.id}:APPOINTMENT_PAST_DUE`,
        attentionRequired: true,
        severity: "HIGH",
        reasonCode: "APPOINTMENT_PAST_DUE",
        title: "Прошедшая запись не закрыта",
        description: `Запись от ${new Date(appt.startAt).toLocaleString("ru-RU")} завершилась, но не отмечена как выполненная или неявка.`,
        entityType: "APPOINTMENT",
        entityId: appt.id,
        clientId: appt.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: firstCycleId,
        appointmentId: appt.id,
        masterId: appt.masterId,
        masterName: master?.displayName,
        dueAt: new Date(appt.endAt),
        isOverdue: new Date(appt.endAt).getTime() < now.getTime(),
        createdAt: appt.createdAt,
        suggestedAction: "Завершить процедуру или отметить статус визита",
        actionUrl: `/calendar`,
        metadata: { status: appt.status, startAt: appt.startAt, endAt: appt.endAt },
      });
    }

    // Cancelled appointment without subsequent future appointment
    if (appt.status === "cancelled" || appt.cancelledAt) {
      // Check if client has future active appointment
      const clientAppts = visibleAppointments.filter(
        (a) => a.clientId === appt.clientId && a.id !== appt.id
      );
      const hasFutureAppt = clientAppts.some(
        (a) =>
          new Date(a.startAt).getTime() > now.getTime() &&
          a.status !== "cancelled" &&
          !a.noShow
      );

      if (!hasFutureAppt) {
        items.push({
          id: `APPOINTMENT:${appt.id}:APPOINTMENT_CANCELLED`,
          attentionRequired: true,
          severity: "HIGH",
          reasonCode: "APPOINTMENT_CANCELLED",
          title: "Запись отменена — требуется перенос",
          description: `Запись была отменена (${appt.cancelReason || "причина не указана"}), новый визит не назначен.`,
          entityType: "APPOINTMENT",
          entityId: appt.id,
          clientId: appt.clientId,
          clientName: client?.name,
          clientPhone: client?.phone ?? undefined,
          cycleId: firstCycleId,
          appointmentId: appt.id,
          masterId: appt.masterId,
          masterName: master?.displayName,
          createdAt: appt.cancelledAt ?? appt.updatedAt,
          suggestedAction: "Связаться с клиентом и перенести запись",
          actionUrl: `/calendar`,
          metadata: { cancelReason: appt.cancelReason },
        });
      }
    }
  }

  // ==========================================
  // EVALUATION: Consultations Follow-Up Overdue
  // ==========================================
  for (const cons of consultationList) {
    const cycle = cycleMap.get(cons.cycleId);
    if (!cycle || (scopedMasterId && cons.masterId !== scopedMasterId)) continue;

    const client = clientMap.get(cycle.clientId);
    const master = masterMap.get(cons.masterId);
    const result = resultByConsultation.get(cons.id);

    // Decision not recorded and past decision due date
    if (!cons.resultRecordedAt && new Date(cons.decisionDueAt).getTime() < now.getTime()) {
      items.push({
        id: `CONSULTATION:${cons.id}:FOLLOW_UP_OVERDUE`,
        attentionRequired: true,
        severity: "HIGH",
        reasonCode: "FOLLOW_UP_OVERDUE",
        title: "Не зафиксировано решение по консультации",
        description: `Срок принятия решения по консультации истек ${new Date(cons.decisionDueAt).toLocaleDateString("ru-RU")}.`,
        entityType: "CONSULTATION",
        entityId: cons.id,
        clientId: cycle.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        cycleId: cycle.id,
        masterId: cons.masterId,
        masterName: master?.displayName,
        dueAt: new Date(cons.decisionDueAt),
        isOverdue: new Date(cons.decisionDueAt).getTime() < now.getTime(),
        createdAt: cons.completedAt,
        suggestedAction: "Зафиксировать решение мастера",
        actionUrl: `/deals/${cycle.id}`,
        metadata: { decisionDueAt: cons.decisionDueAt },
      });
    }

    // Follow-up required (client_thinking) and past due
    if (result && result.outcome === "client_thinking" && !closedResults.has(result.id)) {
      const followUpRevs = followUpRevisionsList.filter((r) => r.resultId === result.id);
      const latestRev = followUpRevs[0];
      const effectiveDueAt = latestRev?.dueAt ?? result.followUpAt;

      if (effectiveDueAt && new Date(effectiveDueAt).getTime() < now.getTime()) {
        items.push({
          id: `CONSULTATION:${cons.id}:FOLLOW_UP_OVERDUE_THINKING`,
          attentionRequired: true,
          severity: "HIGH",
          reasonCode: "FOLLOW_UP_OVERDUE",
          title: "Просрочен повторный контакт после консультации",
          description: `Истек срок повторного контакта с думающим клиентом (${new Date(effectiveDueAt).toLocaleDateString("ru-RU")}).`,
          entityType: "CONSULTATION",
          entityId: cons.id,
          clientId: cycle.clientId,
          clientName: client?.name,
          clientPhone: client?.phone ?? undefined,
          cycleId: cycle.id,
          masterId: cons.masterId,
          masterName: master?.displayName,
          dueAt: new Date(effectiveDueAt),
          isOverdue: new Date(effectiveDueAt).getTime() < now.getTime(),
          createdAt: result.createdAt,
          suggestedAction: "Связаться с клиентом для получения ответа",
          actionUrl: `/deals/${cycle.id}`,
          metadata: { outcome: result.outcome, dueAt: effectiveDueAt },
        });
      }
    }
  }

  // ==========================================
  // EVALUATION: Financial Balances (Deduplicated)
  // ==========================================
  for (const [clientId, entries] of ledgerByClient.entries()) {
    const client = clientMap.get(clientId);
    if (!client) continue;

    // Check if master scope applies
    if (scopedMasterId) {
      const hasMasterCycle = visibleCycles.some((c) => c.clientId === clientId);
      const hasMasterAppt = visibleAppointments.some((a) => a.clientId === clientId);
      if (!hasMasterCycle && !hasMasterAppt) continue;
    }

    const summary = calculateLedgerBalance(entries);
    if (summary.outstanding > 0) {
      items.push({
        id: `CLIENT:${clientId}:OUTSTANDING_BALANCE`,
        attentionRequired: true,
        severity: "MEDIUM",
        reasonCode: "OUTSTANDING_BALANCE",
        title: "Неоплаченный остаток у клиента",
        description: `У клиента числится непогашенная задолженность в размере ${(summary.outstanding / 100).toLocaleString("ru-RU")} ₽.`,
        entityType: "CLIENT",
        entityId: clientId,
        clientId: clientId,
        clientName: client.name,
        clientPhone: client.phone ?? undefined,
        createdAt: client.createdAt,
        suggestedAction: "Проверить реестр платежей и принять оплату",
        actionUrl: `/clients/${clientId}`,
        metadata: {
          outstandingCents: summary.outstanding,
          totalCharges: summary.totalCharges,
          netPaid: summary.netPaid,
        },
      });
    }
  }

  // ==========================================
  // EVALUATION: Total Face Packages
  // ==========================================
  for (const pkg of packageRows) {
    const client = clientMap.get(pkg.clientId);
    const siblingCycles = cycleRows.filter((c) => c.packageId === pkg.id);

    if (scopedMasterId) {
      const hasMasterCycle = siblingCycles.some((c) => c.assignedMasterId === scopedMasterId);
      if (!hasMasterCycle) continue;
    }

    const cycleSummaries = siblingCycles.map((c) => {
      const med = evaluateEffectiveMedicalEligibility({
        cycleId: c.id,
        clientId: c.clientId,
        cycleStage: c.stage,
        currentMedicalProfile: medProfileMap.get(c.clientId) ?? null,
        currentMedicalRevision: latestRevisionByClient.get(c.clientId) ?? null,
        latestCycleMedicalClearance: latestClearanceByCycle.get(c.id) ?? null,
        mergeReviewRequired: medProfileMap.get(c.clientId)?.mergeReviewRequired ?? false,
      });

      const cs = latestConsentByCycle.get(c.id) ?? null;
      const zones = cs ? (coveredZonesByConsent.get(cs.id) ?? []) : [];
      const con = evaluateEffectiveConsent({
        cycleId: c.id,
        clientId: c.clientId,
        cycleStage: c.stage,
        cycleZoneCode: c.zoneCode,
        latestCycleConsent: cs,
        coveredZoneCodes: zones,
      });

      const appts = cycleToAppts.get(c.id) ?? [];
      const nextAppt = appts.find(
        (a) => new Date(a.startAt) > now && a.status !== "cancelled" && !a.noShow
      );

      return evaluateCycleReadiness({
        cycleId: c.id,
        zoneCode: c.zoneCode,
        kind: c.kind,
        stage: c.stage,
        medicalStatus: med.status,
        consentStatus: con.status,
        nextAppointment: nextAppt
          ? {
              id: nextAppt.id,
              startAt: nextAppt.startAt.toISOString(),
              endAt: nextAppt.endAt.toISOString(),
              status: nextAppt.status,
              masterName: masterMap.get(nextAppt.masterId)?.displayName,
            }
          : null,
        completedProceduresCount: (sessionsByCycle.get(c.id) ?? []).filter(
          (s) => s.status === "COMPLETED"
        ).length,
        expectedPriceCents: 0,
        paidCents: 0,
      });
    });

    const dummyFinancial = calculatePackageFinancialSummary([], []);

    const pkgReadiness = evaluatePackageReadiness({
      packageId: pkg.id,
      clientId: pkg.clientId,
      status: pkg.status as any,
      cycles: cycleSummaries,
      financialSummary: dummyFinancial,
    });

    if (pkgReadiness.overallReadiness === "BLOCKED") {
      items.push({
        id: `PACKAGE:${pkg.id}:TOTAL_FACE_BLOCKED`,
        attentionRequired: true,
        severity: "HIGH",
        reasonCode: "TOTAL_FACE_BLOCKED",
        title: "Пакет Total Face заблокирован",
        description: `В пакете Total Face обнаружены зоны с медицинскими или юридическими блокировками.`,
        entityType: "PACKAGE",
        entityId: pkg.id,
        clientId: pkg.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        packageId: pkg.id,
        createdAt: pkg.createdAt,
        suggestedAction: "Открыть пакет Total Face и устранить блокировки зон",
        actionUrl: `/clients/${pkg.clientId}`,
        metadata: {
          overallReadiness: pkgReadiness.overallReadiness,
          totalCycles: pkgReadiness.totalCyclesCount,
        },
      });
    } else if (
      pkgReadiness.overallReadiness === "PARTIALLY_READY" &&
      pkgReadiness.completedCyclesCount > 0 &&
      pkgReadiness.completedCyclesCount < pkgReadiness.totalCyclesCount
    ) {
      items.push({
        id: `PACKAGE:${pkg.id}:TOTAL_FACE_PARTIALLY_COMPLETE`,
        attentionRequired: true,
        severity: "MEDIUM",
        reasonCode: "TOTAL_FACE_PARTIALLY_COMPLETE",
        title: "Пакет Total Face частично выполнен",
        description: `Завершено ${pkgReadiness.completedCyclesCount} из ${pkgReadiness.totalCyclesCount} зон пакета Total Face.`,
        entityType: "PACKAGE",
        entityId: pkg.id,
        clientId: pkg.clientId,
        clientName: client?.name,
        clientPhone: client?.phone ?? undefined,
        packageId: pkg.id,
        createdAt: pkg.createdAt,
        suggestedAction: "Запланировать процедуры по оставшимся зонам",
        actionUrl: `/clients/${pkg.clientId}`,
        metadata: {
          completedCount: pkgReadiness.completedCyclesCount,
          totalCount: pkgReadiness.totalCyclesCount,
        },
      });
    }
  }

  // Enrich items with active handoffs and operational ownership state
  const activeHandoffRows = await db
    .select({
      id: handoffs.id,
      entityType: handoffs.entityType,
      entityId: handoffs.entityId,
      clientId: handoffs.clientId,
      cycleId: handoffs.cycleId,
      appointmentId: handoffs.appointmentId,
      status: handoffs.status,
      toUserId: handoffs.toUserId,
      toUserName: user.name,
    })
    .from(handoffs)
    .leftJoin(user, eq(handoffs.toUserId, user.id))
    .where(
      and(
        eq(handoffs.studioId, studioId),
        or(eq(handoffs.status, "PENDING"), eq(handoffs.status, "ACCEPTED"))
      )
    );

  const handoffMap = new Map<string, (typeof activeHandoffRows)[0]>();
  for (const hf of activeHandoffRows) {
    handoffMap.set(`${hf.entityType}:${hf.entityId}`, hf);
    if (hf.clientId) handoffMap.set(`CLIENT:${hf.clientId}`, hf);
    if (hf.cycleId) handoffMap.set(`TREATMENT_CYCLE:${hf.cycleId}`, hf);
    if (hf.appointmentId) handoffMap.set(`APPOINTMENT:${hf.appointmentId}`, hf);
  }

  for (const item of items) {
    const matchedHandoff =
      handoffMap.get(`${item.entityType}:${item.entityId}`) ||
      (item.cycleId ? handoffMap.get(`TREATMENT_CYCLE:${item.cycleId}`) : undefined) ||
      (item.appointmentId ? handoffMap.get(`APPOINTMENT:${item.appointmentId}`) : undefined) ||
      (item.clientId ? handoffMap.get(`CLIENT:${item.clientId}`) : undefined);

    if (matchedHandoff) {
      item.handoffId = matchedHandoff.id;
      if (matchedHandoff.status === "ACCEPTED") {
        item.ownershipState = "ACCEPTED";
        item.assignedUserId = matchedHandoff.toUserId;
        item.assignedUserName = matchedHandoff.toUserName ?? undefined;
      } else {
        item.ownershipState = "HANDOFF_PENDING";
        item.pendingAssigneeId = matchedHandoff.toUserId;
        item.pendingAssigneeName = matchedHandoff.toUserName ?? undefined;
      }
    } else if (item.masterName) {
      item.ownershipState = "ASSIGNED";
      item.assignedUserName = item.masterName;
    } else {
      item.ownershipState = "UNASSIGNED";
    }
  }

  return items;
}
