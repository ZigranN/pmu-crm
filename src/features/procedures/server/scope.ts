import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { procedureSessions } from "@/db/schema";
import { resourceScope } from "@/server/auth/scopes";
import { entityId, type Transaction } from "@/server/commands/ownership";

export interface ProcedureContext {
  studioId: string;
  userId: string;
  role?: string;
  [key: string]: unknown;
}

export async function procedureScope(context: ProcedureContext, tx: Transaction) {
  entityId.parse(context.studioId);
  z.string().min(1).parse(context.userId);
  const scope = await resourceScope(context, tx);
  return and(
    eq(procedureSessions.studioId, context.studioId),
    isNull(procedureSessions.deletedAt),
    scope.isMaster ? scope.ownsMaster(sql`${procedureSessions.masterId}`) : undefined
  );
}

export async function lockProcedureSession(
  tx: Transaction,
  context: ProcedureContext,
  id: string
) {
  entityId.parse(id);
  const scopeCondition = await procedureScope(context, tx);
  const [row] = await tx
    .select()
    .from(procedureSessions)
    .where(and(eq(procedureSessions.id, id), scopeCondition))
    .for("update");

  if (!row) {
    throw new Error("Сессия процедуры не найдена или недоступна");
  }

  return row;
}
