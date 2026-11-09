import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  masters,
  procedurePigments,
  procedureSessions,
  services,
} from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { lockStudioAccess } from "@/server/auth/scopes";
import { entityId } from "@/server/commands/ownership";
import { sensitiveRead } from "@/server/services/access-log.service";
import { procedureScope } from "./scope";

export async function getProcedureSession(id: string) {
  entityId.parse(id);

  return sensitiveRead(
    "PROCEDURE_READ",
    undefined,
    { operation: "procedure.read", targetId: id },
    (context) =>
      db.transaction(async (tx) => {
        await lockStudioAccess(tx, context);
        const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_READ");
        if (!allowed) {
          throw new Error("Недостаточно прав для просмотра процедуры");
        }

        const scopeCondition = await procedureScope(context, tx);
        const [session] = await tx
          .select()
          .from(procedureSessions)
          .where(and(eq(procedureSessions.id, id), scopeCondition));

        if (!session) {
          throw new Error("Сессия процедуры не найдена или недоступна");
        }

        // Fetch linked pigments
        const pigmentsList = await tx
          .select()
          .from(procedurePigments)
          .where(eq(procedurePigments.procedureSessionId, session.id));

        // Fetch master details
        const [master] = await tx
          .select({
            id: masters.id,
            displayName: masters.displayName,
          })
          .from(masters)
          .where(eq(masters.id, session.masterId));

        // Fetch service details
        const [service] = await tx
          .select({
            id: services.id,
            name: services.name,
            category: services.category,
            priceCents: services.priceCents,
          })
          .from(services)
          .where(eq(services.id, session.serviceId));

        // Fetch client details
        const [client] = await tx
          .select({
            id: clients.id,
            fullName: clients.fullName,
            phone: clients.phone,
          })
          .from(clients)
          .where(eq(clients.id, session.clientId));

        return {
          ...session,
          master,
          service,
          client,
          pigments: pigmentsList,
        };
      }),
    (result) => [result.id]
  );
}

export async function getCycleProcedureHistory(cycleId: string) {
  entityId.parse(cycleId);

  return sensitiveRead(
    "PROCEDURE_READ",
    undefined,
    { operation: "procedures.history", targetId: cycleId },
    (context) =>
      db.transaction(async (tx) => {
        await lockStudioAccess(tx, context);
        const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_READ");
        if (!allowed) {
          throw new Error("Недостаточно прав для просмотра истории процедур");
        }

        const scopeCondition = await procedureScope(context, tx);
        const rows = await tx
          .select({
            id: procedureSessions.id,
            cycleId: procedureSessions.cycleId,
            appointmentId: procedureSessions.appointmentId,
            status: procedureSessions.status,
            startedAt: procedureSessions.startedAt,
            completedAt: procedureSessions.completedAt,
            abortedAt: procedureSessions.abortedAt,
            abortReason: procedureSessions.abortReason,
            procedureArea: procedureSessions.procedureArea,
            procedureType: procedureSessions.procedureType,
            sessionType: procedureSessions.sessionType,
            healingStage: procedureSessions.healingStage,
            painLevel: procedureSessions.painLevel,
            skinReaction: procedureSessions.skinReaction,
            notes: procedureSessions.notes,
            recommendations: procedureSessions.recommendations,
            nextStep: procedureSessions.nextStep,
            nextRecommendedDate: procedureSessions.nextRecommendedDate,
            anesthesia: procedureSessions.anesthesia,
            cartridge: procedureSessions.cartridge,
            needle: procedureSessions.needle,
            voltage: procedureSessions.voltage,
            machine: procedureSessions.machine,
            createdAt: procedureSessions.createdAt,
            masterDisplayName: masters.displayName,
            serviceName: services.name,
          })
          .from(procedureSessions)
          .leftJoin(masters, eq(masters.id, procedureSessions.masterId))
          .leftJoin(services, eq(services.id, procedureSessions.serviceId))
          .where(and(eq(procedureSessions.cycleId, cycleId), scopeCondition))
          .orderBy(desc(procedureSessions.createdAt), desc(procedureSessions.id));

        // Fetch pigments for these sessions
        const sessionIds = rows.map((r) => r.id);
        const pigmentsMap: Record<string, typeof procedurePigments.$inferSelect[]> = {};

        if (sessionIds.length > 0) {
          for (const sId of sessionIds) {
            const pRows = await tx
              .select()
              .from(procedurePigments)
              .where(eq(procedurePigments.procedureSessionId, sId));
            pigmentsMap[sId] = pRows;
          }
        }

        return rows.map((r) => ({
          ...r,
          pigments: pigmentsMap[r.id] || [],
        }));
      }),
    (results) => results.map((r) => r.id)
  );
}

export async function getClientProcedureHistory(clientId: string) {
  entityId.parse(clientId);

  return sensitiveRead(
    "PROCEDURE_READ",
    undefined,
    { operation: "procedures.history", targetId: clientId },
    (context) =>
      db.transaction(async (tx) => {
        await lockStudioAccess(tx, context);
        const allowed = await hasPermission(tx, context.userId, context.studioId, "PROCEDURE_READ");
        if (!allowed) {
          throw new Error("Недостаточно прав для просмотра истории процедур");
        }

        const scopeCondition = await procedureScope(context, tx);
        const rows = await tx
          .select({
            id: procedureSessions.id,
            cycleId: procedureSessions.cycleId,
            appointmentId: procedureSessions.appointmentId,
            status: procedureSessions.status,
            startedAt: procedureSessions.startedAt,
            completedAt: procedureSessions.completedAt,
            abortedAt: procedureSessions.abortedAt,
            abortReason: procedureSessions.abortReason,
            procedureArea: procedureSessions.procedureArea,
            procedureType: procedureSessions.procedureType,
            sessionType: procedureSessions.sessionType,
            healingStage: procedureSessions.healingStage,
            painLevel: procedureSessions.painLevel,
            skinReaction: procedureSessions.skinReaction,
            notes: procedureSessions.notes,
            recommendations: procedureSessions.recommendations,
            nextStep: procedureSessions.nextStep,
            nextRecommendedDate: procedureSessions.nextRecommendedDate,
            anesthesia: procedureSessions.anesthesia,
            cartridge: procedureSessions.cartridge,
            needle: procedureSessions.needle,
            voltage: procedureSessions.voltage,
            machine: procedureSessions.machine,
            createdAt: procedureSessions.createdAt,
            masterDisplayName: masters.displayName,
            serviceName: services.name,
          })
          .from(procedureSessions)
          .leftJoin(masters, eq(masters.id, procedureSessions.masterId))
          .leftJoin(services, eq(services.id, procedureSessions.serviceId))
          .where(and(eq(procedureSessions.clientId, clientId), scopeCondition))
          .orderBy(desc(procedureSessions.createdAt), desc(procedureSessions.id));

        return rows;
      }),
    (results) => results.map((r) => r.id)
  );
}
