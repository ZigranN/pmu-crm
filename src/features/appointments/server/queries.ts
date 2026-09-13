import "server-only";
import { db } from "@/db";
import { appointments, clients } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireStudioPermission } from "@/server/auth/context";
import { resourceScope } from "@/server/auth/scopes";
export async function getClientAppointments(clientId: string, studioId: string) {
  const context = await requireStudioPermission("APPOINTMENT_READ", studioId);
  const scope = await resourceScope(context);
  const rows = await db.select({ appointment: appointments }).from(appointments).innerJoin(clients,
    and(eq(clients.id, appointments.clientId), eq(clients.studioId, appointments.studioId)))
    .where(and(eq(appointments.clientId, clientId), eq(appointments.studioId, studioId), isNull(appointments.deletedAt), isNull(clients.deletedAt), scope.client,
      scope.isMaster ? scope.ownsMaster(sql`${appointments.masterId}`) : undefined));
  return rows.map(r => r.appointment);
}
