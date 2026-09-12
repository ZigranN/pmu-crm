import "server-only";
import { db } from "@/db";
import { clients, appointments, procedureSessions } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const entityId = z.string().uuid();

export async function lockClient(tx: Transaction, clientId: string, studioId: string) {
  entityId.parse(clientId);
  const [client] = await tx.select().from(clients).where(and(
    eq(clients.id, clientId), eq(clients.studioId, studioId), isNull(clients.deletedAt),
  )).for("update");
  if (!client) throw new Error("Client not found");
  return client;
}

export async function validateMediaLinks(tx: Transaction, input: {
  clientId: string; studioId: string; appointmentId?: string; procedureSessionId?: string;
}) {
  await lockClient(tx, input.clientId, input.studioId);
  if (input.appointmentId) {
    entityId.parse(input.appointmentId);
    const [appointment] = await tx.select().from(appointments).where(and(
      eq(appointments.id, input.appointmentId), eq(appointments.clientId, input.clientId),
      eq(appointments.studioId, input.studioId), isNull(appointments.deletedAt),
    )).for("share");
    if (!appointment) throw new Error("Appointment not found");
  }
  if (input.procedureSessionId) {
    entityId.parse(input.procedureSessionId);
    const [procedure] = await tx.select().from(procedureSessions).where(and(
      eq(procedureSessions.id, input.procedureSessionId), eq(procedureSessions.clientId, input.clientId),
      eq(procedureSessions.studioId, input.studioId), isNull(procedureSessions.deletedAt),
    )).for("share");
    if (!procedure || (input.appointmentId && procedure.appointmentId !== input.appointmentId)) {
      throw new Error("Procedure session not found");
    }
  }
}
