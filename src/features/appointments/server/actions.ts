"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { requireBrowserStudioContext } from "@/server/auth/context";
import {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  getAppointmentById,
} from "./service";
import { treatmentCycles, clients, services, masters } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { resolveEffectiveMedicalEligibility } from "@/features/medical/server/eligibility";
import { resolveEffectiveConsent } from "@/features/consent/server/coverage";
import { getAppointmentFinancialSummary } from "@/features/ledger/server/service";

const createSchema = z.object({
  clientId: z.string().uuid(),
  masterId: z.string().uuid(),
  cycleId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  visitKind: z.enum(["consultation", "procedure", "touch_up"]).default("consultation"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  notes: z.string().max(1000).nullable().optional(),
  source: z.enum(["whatsapp", "instagram", "phone", "walk_in", "referral", "returning_client", "other"]).default("other"),
  idempotencyKey: z.string().uuid().optional(),
});

const rescheduleSchema = z.object({
  appointmentId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const cancelSchema = z.object({
  appointmentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export async function createAppointmentAction(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await createAppointment(
    db,
    { studioId: context.studioId, userId: context.userId },
    {
      clientId: parsed.clientId,
      masterId: parsed.masterId,
      cycleId: parsed.cycleId,
      serviceId: parsed.serviceId,
      visitKind: parsed.visitKind,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      notes: parsed.notes,
      source: parsed.source,
    },
    parsed.idempotencyKey
  );

  revalidatePath("/calendar");
  revalidatePath(`/clients/${parsed.clientId}`);
  return res;
}

export async function rescheduleAppointmentAction(input: z.infer<typeof rescheduleSchema>) {
  const parsed = rescheduleSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await rescheduleAppointment(
    db,
    { studioId: context.studioId, userId: context.userId },
    {
      appointmentId: parsed.appointmentId,
      startsAt: new Date(parsed.startsAt),
      endsAt: new Date(parsed.endsAt),
      reason: parsed.reason,
    },
    parsed.idempotencyKey
  );

  revalidatePath("/calendar");
  return res;
}

export async function cancelAppointmentAction(input: z.infer<typeof cancelSchema>) {
  const parsed = cancelSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await cancelAppointment(
    db,
    { studioId: context.studioId, userId: context.userId },
    {
      appointmentId: parsed.appointmentId,
      reason: parsed.reason,
    },
    parsed.idempotencyKey
  );

  revalidatePath("/calendar");
  return res;
}

export async function getAppointmentDetailsAction(appointmentId: string) {
  z.string().uuid().parse(appointmentId);
  const context = await requireBrowserStudioContext();

  const details = await getAppointmentById(
    db,
    { studioId: context.studioId, userId: context.userId },
    appointmentId
  );

  let medicalSummary = null;
  let consentSummary = null;

  if (details.cycle?.id) {
    try {
      const eligibility = await resolveEffectiveMedicalEligibility(
        { studioId: context.studioId, userId: context.userId },
        details.cycle.id
      );
      medicalSummary = {
        status: eligibility.status,
        reasonCode: eligibility.reasonCode,
      };
    } catch {
      // Non-blocking
    }

    try {
      const consent = await resolveEffectiveConsent(
        { studioId: context.studioId, userId: context.userId },
        details.cycle.id
      );
      consentSummary = {
        status: consent.status,
        signedAt: consent.signedAt,
      };
    } catch {
      // Non-blocking
    }
  }

  let financialSummary = null;
  try {
    financialSummary = await getAppointmentFinancialSummary(
      db,
      { studioId: context.studioId, userId: context.userId },
      appointmentId
    );
  } catch {
    // Non-blocking
  }

  return {
    ...details,
    medicalSummary,
    consentSummary,
    financialSummary,
  };
}

export async function getBookingOptionsAction() {
  const context = await requireBrowserStudioContext();

  const [activeClients, activeServices, activeMasters] = await Promise.all([
    db
      .select({
        id: clients.id,
        fullName: clients.fullName,
        phone: clients.phone,
      })
      .from(clients)
      .where(
        and(
          eq(clients.studioId, context.studioId),
          isNull(clients.deletedAt),
          isNull(clients.mergedIntoId)
        )
      )
      .orderBy(clients.fullName)
      .limit(100),
    db
      .select({
        id: services.id,
        name: services.name,
        priceCents: services.priceCents,
        durationMinutes: services.durationMinutes,
        procedureType: services.procedureType,
      })
      .from(services)
      .where(
        and(
          eq(services.studioId, context.studioId),
          isNull(services.deletedAt),
          eq(services.isActive, true)
        )
      )
      .orderBy(services.name),
    db
      .select({
        id: masters.id,
        displayName: masters.displayName,
      })
      .from(masters)
      .where(
        and(
          eq(masters.studioId, context.studioId),
          isNull(masters.deletedAt),
          eq(masters.isActive, true)
        )
      )
      .orderBy(masters.displayName),
  ]);

  return {
    clients: activeClients,
    services: activeServices,
    masters: activeMasters,
  };
}

export async function getClientCyclesAction(clientId: string) {
  z.string().uuid().parse(clientId);
  const context = await requireBrowserStudioContext();

  const cycles = await db
    .select({
      id: treatmentCycles.id,
      zoneCode: treatmentCycles.zoneCode,
      stage: treatmentCycles.stage,
      kind: treatmentCycles.kind,
    })
    .from(treatmentCycles)
    .where(
      and(
        eq(treatmentCycles.studioId, context.studioId),
        eq(treatmentCycles.clientId, clientId),
        isNull(treatmentCycles.archivedAt)
      )
    );

  return cycles;
}
