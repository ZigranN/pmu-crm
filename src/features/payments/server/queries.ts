import "server-only";
import { sensitiveRead, recordIds, } from "@/server/services/access-log.service";
import { db } from "@/db";
import { payments, clients, paymentTransactions } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireStudioPermission } from "@/server/auth/context";
import { resourceScope } from "@/server/auth/scopes";
async function paymentVisibility(clientId: string, studioId: string) {
  const context = await requireStudioPermission("PAYMENT_READ", studioId);
  const scope = await resourceScope(context);
  // Unattributed or contradictory legacy finance links are hidden from Master.
  const ownAppointment = sql`exists (select 1 from appointments pa where pa.id = ${payments.appointmentId}
    and pa.studio_id = ${studioId} and pa.client_id = ${clientId} and pa.deleted_at is null and ${scope.ownsMaster(sql`pa.master_id`)})`;
  const ownProcedure = sql`exists (select 1 from procedure_sessions ps where ps.id = ${payments.procedureSessionId}
    and ps.studio_id = ${studioId} and ps.client_id = ${clientId} and ps.deleted_at is null and ${scope.ownsMaster(sql`ps.master_id`)})`;
  return and(eq(payments.clientId, clientId), eq(payments.studioId, studioId), isNull(payments.deletedAt), isNull(clients.deletedAt), scope.client,
    scope.isMaster ? sql`(${payments.appointmentId} is not null or ${payments.procedureSessionId} is not null)
      and (${payments.appointmentId} is null or ${ownAppointment}) and (${payments.procedureSessionId} is null or ${ownProcedure})` : undefined);
}
export async function getClientPayments(clientId: string, studioId: string) {
  return sensitiveRead("PAYMENT_READ", studioId, { operation: "payments.list", targetId: clientId }, async () => {
    const visible = await paymentVisibility(clientId, studioId);
    const rows = await db.select({ payment: payments }).from(payments).innerJoin(clients,
      and(eq(clients.id, payments.clientId), eq(clients.studioId, payments.studioId))).where(visible);
    return rows.map(r => r.payment);
  }, recordIds);
}
export async function getClientPaymentTransactions(clientId: string, studioId: string) {
  return sensitiveRead("PAYMENT_READ", studioId, { operation: "transactions.list", targetId: clientId }, async () => {
    const visible = await paymentVisibility(clientId, studioId);
    const rows = await db.select({ transaction: paymentTransactions }).from(paymentTransactions)
      .innerJoin(payments, and(eq(payments.id, paymentTransactions.paymentId), eq(payments.clientId, paymentTransactions.clientId), eq(payments.studioId, paymentTransactions.studioId)))
      .innerJoin(clients, and(eq(clients.id, payments.clientId), eq(clients.studioId, payments.studioId)))
      .where(and(visible, isNull(paymentTransactions.deletedAt),
        sql`(${paymentTransactions.appointmentId} is null or ${paymentTransactions.appointmentId} = ${payments.appointmentId})`,
        sql`(${paymentTransactions.procedureSessionId} is null or ${paymentTransactions.procedureSessionId} = ${payments.procedureSessionId})`));
    return rows.map(r => r.transaction);
  }, recordIds);
}
