import "server-only";
import { db } from "@/db";
import { clients, masters, studios } from "@/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { getStudioRole } from "@/lib/roles";
import type { Transaction } from "@/server/commands/ownership";

type Context = { studioId: string; userId: string };
export async function resourceScope(context: Context, executor: typeof db | Transaction = db) {
  const role = await getStudioRole(executor, context.userId, context.studioId);
  if (!role || role === "CLIENT" || role === "AI_SYSTEM") throw new Error("Permission denied");
  const isMaster = role === "MASTER";
  // Keep correlation in the SQL statement: never fetch IDs into a stale allowlist.
  const ownsMaster = (column: SQL | typeof masters.id | typeof clients.assignedMasterId) => sql`exists (
    select 1 from masters scope_master where scope_master.id = ${column}
    and scope_master.studio_id = ${context.studioId} and scope_master.user_id = ${context.userId}
    and scope_master.is_active = true and scope_master.deleted_at is null)`;
  const currentActor = sql`exists (select 1 from studio_members sm join roles sr on sr.id = sm.role_id
    join studios ss on ss.id = sm.studio_id where sm.user_id = ${context.userId} and sm.studio_id = ${context.studioId}
    and sm.is_active = true and ss.is_active = true and
    (case sr.code when 'SUPER_ADMIN' then 'OWNER' when 'STUDIO_ADMIN' then 'OWNER' when 'ASSISTANT' then 'ADMIN' else sr.code end) = ${role})`;
  const client = and(currentActor, eq(clients.studioId, context.studioId), isMaster ? ownsMaster(clients.assignedMasterId) : undefined)!;
  const master = and(currentActor, eq(masters.studioId, context.studioId), isMaster ? ownsMaster(masters.id) : undefined)!;
  // Raw inner alias is deliberate: Drizzle relational queries remap Column objects
  // to their outer table alias, including those nested inside an SQL expression.
  const clientReference = (column: SQL) => sql`exists (select 1 from clients scope_client where scope_client.id = ${column}
    and scope_client.studio_id = ${context.studioId} and scope_client.deleted_at is null and ${currentActor}
    and ${isMaster ? ownsMaster(sql`scope_client.assigned_master_id`) : sql`true`})`;
  return { role, currentActor, isMaster, ownsMaster, client, master, clientReference };
}

// Serialize changes of membership/binding/assignment with client writes.
export async function lockStudioAccess(tx: Transaction, context: Context) {
  const { studioId } = context;
  const [studio] = await tx.select().from(studios).where(and(eq(studios.id, studioId), eq(studios.isActive, true))).for("update");
  if (!studio) throw new Error("Permission denied");
  const role = await getStudioRole(tx, context.userId, studioId);
  if (!role || role === "CLIENT" || role === "AI_SYSTEM") throw new Error("Permission denied");
  return { ...context, role };
}

/**
 * Execute command in explicit browser studio context.
 */
export async function withBrowserStudioCommand<T>(
  permission: import("@/lib/permissions").PermissionCode,
  command: (tx: Transaction, context: Context) => Promise<T>
) {
  const { requireBrowserStudioPermission, ForbiddenPermissionError } = await import("./context");
  const { hasPermission } = await import("@/lib/permissions");
  const context = await requireBrowserStudioPermission(permission);
  return db.transaction(async (tx) => {
    await lockStudioAccess(tx, context);
    if (!(await hasPermission(tx, context.userId, context.studioId, permission))) {
      throw new ForbiddenPermissionError("FORBIDDEN_PERMISSION");
    }
    return command(tx, context);
  });
}

/**
 * @deprecated Transitional legacy command helper. Will be migrated in PHASE 1.1C.
 */
export async function withStudioCommand<T>(permission: import("@/lib/permissions").PermissionCode,
  command: (tx: Transaction, context: Context) => Promise<T>) {
  const { requireStudioPermission } = await import("./context");
  const { hasPermission } = await import("@/lib/permissions");
  const context = await requireStudioPermission(permission);
  return db.transaction(async tx => {
    await lockStudioAccess(tx, context);
    if (!await hasPermission(tx, context.userId, context.studioId, permission)) throw new Error("Permission denied");
    return command(tx, context);
  });
}
