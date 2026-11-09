import "server-only";

import { and, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { clients, handoffs, roles, studioMembers, user } from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";
import type {
  HandoffFilters,
  HandoffPriority,
  HandoffQueueItem,
  HandoffRecord,
  HandoffSummaryCounts,
} from "../domain/types";
import { normalizeRole } from "@/lib/roles";

const toUser = alias(user, "to_user");
const fromUser = alias(user, "from_user");
const createdByUser = alias(user, "created_by_user");
const acceptedByUser = alias(user, "accepted_by_user");

const PRIORITY_WEIGHT: Record<HandoffPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export async function listHandoffs(
  filters?: HandoffFilters
): Promise<HandoffQueueItem[]> {
  return sensitiveRead(
    "HANDOFF_READ",
    undefined,
    { operation: "handoffs.list" },
    async (context) => {
      const now = new Date();
      const conditions = [eq(handoffs.studioId, context.studioId)];

      // Fetch member role in studio
      const [member] = await db
        .select({ roleCode: roles.code })
        .from(studioMembers)
        .innerJoin(roles, eq(studioMembers.roleId, roles.id))
        .where(
          and(
            eq(studioMembers.studioId, context.studioId),
            eq(studioMembers.userId, context.userId),
            eq(studioMembers.isActive, true)
          )
        );

      const normalizedRole = normalizeRole(member?.roleCode ?? "MASTER");
      if (normalizedRole === "MASTER" && !filters?.toUserId) {
        if (!filters?.createdByMe && !filters?.assignedToMe) {
          conditions.push(
            or(
              eq(handoffs.toUserId, context.userId),
              eq(handoffs.createdById, context.userId),
              eq(handoffs.acceptedById, context.userId)
            )!
          );
        }
      }

      if (filters?.assignedToMe) {
        conditions.push(eq(handoffs.toUserId, context.userId));
      }

      if (filters?.createdByMe) {
        conditions.push(eq(handoffs.createdById, context.userId));
      }

      if (filters?.toUserId) {
        conditions.push(eq(handoffs.toUserId, filters.toUserId));
      }

      if (filters?.status) {
        conditions.push(eq(handoffs.status, filters.status));
      }

      if (filters?.priority) {
        conditions.push(eq(handoffs.priority, filters.priority));
      }

      if (filters?.entityType) {
        conditions.push(eq(handoffs.entityType, filters.entityType));
      }

      if (filters?.clientId) {
        conditions.push(eq(handoffs.clientId, filters.clientId));
      }

      if (filters?.overdueOnly) {
        conditions.push(
          and(
            sql`${handoffs.dueAt} IS NOT NULL`,
            sql`${handoffs.dueAt} < ${now}`,
            or(
              eq(handoffs.status, "PENDING"),
              eq(handoffs.status, "ACCEPTED")
            )!
          )!
        );
      }

      if (filters?.search) {
        const term = `%${filters.search.trim()}%`;
        conditions.push(
          or(
            ilike(handoffs.reasonCode, term),
            ilike(handoffs.reasonText, term),
            ilike(clients.fullName, term),
            ilike(clients.phone, term),
            ilike(toUser.name, term)
          )!
        );
      }

      const rows = await db
        .select({
          id: handoffs.id,
          studioId: handoffs.studioId,
          entityType: handoffs.entityType,
          entityId: handoffs.entityId,
          clientId: handoffs.clientId,
          cycleId: handoffs.cycleId,
          conversationId: handoffs.conversationId,
          appointmentId: handoffs.appointmentId,
          fromUserId: handoffs.fromUserId,
          toUserId: handoffs.toUserId,
          sourceType: handoffs.sourceType,
          reasonCode: handoffs.reasonCode,
          reasonText: handoffs.reasonText,
          status: handoffs.status,
          priority: handoffs.priority,
          dueAt: handoffs.dueAt,
          requestKey: handoffs.requestKey,
          metadata: handoffs.metadata,
          createdById: handoffs.createdById,
          createdAt: handoffs.createdAt,
          acceptedAt: handoffs.acceptedAt,
          acceptedById: handoffs.acceptedById,
          rejectedAt: handoffs.rejectedAt,
          rejectedById: handoffs.rejectedById,
          rejectionReason: handoffs.rejectionReason,
          completedAt: handoffs.completedAt,
          completedById: handoffs.completedById,
          cancelledAt: handoffs.cancelledAt,
          cancelledById: handoffs.cancelledById,
          cancellationReason: handoffs.cancellationReason,
          updatedAt: handoffs.updatedAt,
          clientName: clients.fullName,
          clientPhone: clients.phone,
          toUserName: toUser.name,
          fromUserName: fromUser.name,
          createdByName: createdByUser.name,
          acceptedByName: acceptedByUser.name,
        })
        .from(handoffs)
        .leftJoin(clients, eq(handoffs.clientId, clients.id))
        .leftJoin(toUser, eq(handoffs.toUserId, toUser.id))
        .leftJoin(fromUser, eq(handoffs.fromUserId, fromUser.id))
        .leftJoin(createdByUser, eq(handoffs.createdById, createdByUser.id))
        .leftJoin(acceptedByUser, eq(handoffs.acceptedById, acceptedByUser.id))
        .where(and(...conditions));

      const items: HandoffQueueItem[] = rows.map((r) => {
        const isOverdue =
          r.dueAt !== null &&
          new Date(r.dueAt) < now &&
          (r.status === "PENDING" || r.status === "ACCEPTED");
        return {
          ...r,
          metadata: (r.metadata as Record<string, unknown>) ?? null,
          isOverdue,
        };
      });

      // Stable sorting:
      // 1. Overdue first
      // 2. Priority descending (URGENT > HIGH > NORMAL > LOW)
      // 3. dueAt ascending (nulls last)
      // 4. createdAt descending
      // 5. id fallback
      return items.sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;

        const pA = PRIORITY_WEIGHT[a.priority] ?? 0;
        const pB = PRIORITY_WEIGHT[b.priority] ?? 0;
        if (pA !== pB) return pB - pA;

        if (a.dueAt && b.dueAt) {
          const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
          if (diff !== 0) return diff;
        } else if (a.dueAt && !b.dueAt) {
          return -1;
        } else if (!a.dueAt && b.dueAt) {
          return 1;
        }

        const createdDiff =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (createdDiff !== 0) return createdDiff;

        return a.id.localeCompare(b.id);
      });
    },
    (items) => Array.from(new Set(items.map((i) => i.id)))
  );
}

export async function getHandoff(
  id: string
): Promise<HandoffQueueItem | null> {
  return sensitiveRead(
    "HANDOFF_READ",
    id,
    { operation: "handoff.read" },
    async (context) => {
      const now = new Date();
      const [r] = await db
        .select({
          id: handoffs.id,
          studioId: handoffs.studioId,
          entityType: handoffs.entityType,
          entityId: handoffs.entityId,
          clientId: handoffs.clientId,
          cycleId: handoffs.cycleId,
          conversationId: handoffs.conversationId,
          appointmentId: handoffs.appointmentId,
          fromUserId: handoffs.fromUserId,
          toUserId: handoffs.toUserId,
          sourceType: handoffs.sourceType,
          reasonCode: handoffs.reasonCode,
          reasonText: handoffs.reasonText,
          status: handoffs.status,
          priority: handoffs.priority,
          dueAt: handoffs.dueAt,
          requestKey: handoffs.requestKey,
          metadata: handoffs.metadata,
          createdById: handoffs.createdById,
          createdAt: handoffs.createdAt,
          acceptedAt: handoffs.acceptedAt,
          acceptedById: handoffs.acceptedById,
          rejectedAt: handoffs.rejectedAt,
          rejectedById: handoffs.rejectedById,
          rejectionReason: handoffs.rejectionReason,
          completedAt: handoffs.completedAt,
          completedById: handoffs.completedById,
          cancelledAt: handoffs.cancelledAt,
          cancelledById: handoffs.cancelledById,
          cancellationReason: handoffs.cancellationReason,
          updatedAt: handoffs.updatedAt,
          clientName: clients.fullName,
          clientPhone: clients.phone,
          toUserName: toUser.name,
          fromUserName: fromUser.name,
          createdByName: createdByUser.name,
          acceptedByName: acceptedByUser.name,
        })
        .from(handoffs)
        .leftJoin(clients, eq(handoffs.clientId, clients.id))
        .leftJoin(toUser, eq(handoffs.toUserId, toUser.id))
        .leftJoin(fromUser, eq(handoffs.fromUserId, fromUser.id))
        .leftJoin(createdByUser, eq(handoffs.createdById, createdByUser.id))
        .leftJoin(acceptedByUser, eq(handoffs.acceptedById, acceptedByUser.id))
        .where(
          and(
            eq(handoffs.id, id),
            eq(handoffs.studioId, context.studioId)
          )
        );

      if (!r) return null;

      const isOverdue =
        r.dueAt !== null &&
        new Date(r.dueAt) < now &&
        (r.status === "PENDING" || r.status === "ACCEPTED");

      return {
        ...r,
        metadata: (r.metadata as Record<string, unknown>) ?? null,
        isOverdue,
      };
    },
    (item) => (item ? [item.id] : [])
  );
}

export async function getHandoffSummaryCounts(): Promise<HandoffSummaryCounts> {
  const allItems = await listHandoffs();

  let pendingToMe = 0;
  let acceptedByMe = 0;
  let overdue = 0;
  let totalPending = 0;
  let totalCompleted = 0;

  for (const item of allItems) {
    if (item.status === "PENDING") {
      totalPending++;
      pendingToMe++;
    }
    if (item.status === "ACCEPTED") {
      acceptedByMe++;
    }
    if (item.isOverdue) {
      overdue++;
    }
    if (item.status === "COMPLETED") {
      totalCompleted++;
    }
  }

  return {
    pendingToMe,
    acceptedByMe,
    createdByMe: 0,
    overdue,
    totalPending,
    totalCompleted,
  };
}

/**
 * Returns a map of active (PENDING/ACCEPTED) handoffs by entity ID for a studio.
 */
export async function getActiveHandoffsMap(
  studioId: string
): Promise<Map<string, HandoffRecord>> {
  const rows = await db
    .select()
    .from(handoffs)
    .where(
      and(
        eq(handoffs.studioId, studioId),
        or(eq(handoffs.status, "PENDING"), eq(handoffs.status, "ACCEPTED"))
      )
    );

  const map = new Map<string, HandoffRecord>();
  for (const row of rows) {
    map.set(`${row.entityType}:${row.entityId}`, {
      ...row,
      metadata: (row.metadata as Record<string, unknown>) ?? null,
    });
    if (row.clientId) map.set(`CLIENT:${row.clientId}`, row as any);
    if (row.cycleId) map.set(`TREATMENT_CYCLE:${row.cycleId}`, row as any);
    if (row.conversationId) map.set(`CONVERSATION:${row.conversationId}`, row as any);
    if (row.appointmentId) map.set(`APPOINTMENT:${row.appointmentId}`, row as any);
  }
  return map;
}
