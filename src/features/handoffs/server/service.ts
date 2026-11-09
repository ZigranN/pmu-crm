import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appointments,
  clients,
  conversations,
  handoffs,
  roles,
  studioMembers,
  treatmentCycles,
} from "@/db/schema";
import { lockStudioAccess } from "@/server/auth/scopes";
import { hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/server/services/audit-log.service";
import type { Transaction } from "@/server/commands/ownership";
import {
  acceptHandoffSchema,
  cancelHandoffSchema,
  completeHandoffSchema,
  createHandoffSchema,
  rejectHandoffSchema,
  type AcceptHandoffInput,
  type CancelHandoffInput,
  type CompleteHandoffInput,
  type CreateHandoffInput,
  type RejectHandoffInput,
} from "../schemas/handoff.schema";

export interface HandoffContext {
  studioId: string;
  userId: string;
  role?: string;
}

async function executeInTransaction<T>(
  dbExecutor: typeof db | Transaction,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  if ("transaction" in dbExecutor && typeof dbExecutor.transaction === "function") {
    return dbExecutor.transaction(fn);
  }
  return fn(dbExecutor as Transaction);
}

/**
 * Creates a new handoff responsibility record transactionally.
 */
export async function createHandoff(
  dbExecutor: any,
  context: HandoffContext,
  input: CreateHandoffInput
): Promise<typeof handoffs.$inferSelect> {
  const parsed = createHandoffSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const canCreate = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_CREATE"
    );
    if (!canCreate) {
      throw new Error("Permission denied: cannot create handoff");
    }

    // Verify assigned user belongs to Studio and is active staff
    const [assigneeMember] = await tx
      .select({
        userId: studioMembers.userId,
        roleCode: roles.code,
      })
      .from(studioMembers)
      .innerJoin(roles, eq(studioMembers.roleId, roles.id))
      .where(
        and(
          eq(studioMembers.studioId, context.studioId),
          eq(studioMembers.userId, parsed.toUserId),
          eq(studioMembers.isActive, true)
        )
      );

    if (!assigneeMember) {
      throw new Error("Assigned user must be an active member of this studio");
    }

    if (
      assigneeMember.roleCode === "CLIENT" ||
      assigneeMember.roleCode === "AI_SYSTEM"
    ) {
      throw new Error("Cannot assign operational handoff to client or AI system");
    }

    // Resolve entities & verify tenant scope
    let resolvedClientId = parsed.clientId ?? null;
    let resolvedCycleId = parsed.cycleId ?? null;
    let resolvedConversationId = parsed.conversationId ?? null;
    let resolvedAppointmentId = parsed.appointmentId ?? null;

    if (parsed.entityType === "CLIENT") {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(
          and(
            eq(clients.id, parsed.entityId),
            eq(clients.studioId, context.studioId)
          )
        );
      if (!client) throw new Error("Client not found");
      resolvedClientId = client.id;
    } else if (parsed.entityType === "TREATMENT_CYCLE") {
      const [cycle] = await tx
        .select({ id: treatmentCycles.id, clientId: treatmentCycles.clientId })
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, parsed.entityId),
            eq(treatmentCycles.studioId, context.studioId)
          )
        );
      if (!cycle) throw new Error("Treatment cycle not found");
      resolvedCycleId = cycle.id;
      if (!resolvedClientId) resolvedClientId = cycle.clientId;
    } else if (parsed.entityType === "CONVERSATION") {
      const [conv] = await tx
        .select({
          id: conversations.id,
          clientId: conversations.clientId,
          cycleId: conversations.cycleId,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, parsed.entityId),
            eq(conversations.studioId, context.studioId)
          )
        );
      if (!conv) throw new Error("Conversation not found");
      resolvedConversationId = conv.id;
      if (!resolvedClientId) resolvedClientId = conv.clientId;
      if (!resolvedCycleId) resolvedCycleId = conv.cycleId;
    } else if (parsed.entityType === "APPOINTMENT") {
      const [appt] = await tx
        .select({ id: appointments.id, clientId: appointments.clientId })
        .from(appointments)
        .where(
          and(
            eq(appointments.id, parsed.entityId),
            eq(appointments.studioId, context.studioId)
          )
        );
      if (!appt) throw new Error("Appointment not found");
      resolvedAppointmentId = appt.id;
      if (!resolvedClientId) resolvedClientId = appt.clientId;
    } else if (parsed.entityType === "NEEDS_ATTENTION_ITEM") {
      if (resolvedClientId) {
        const [client] = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(
            and(
              eq(clients.id, resolvedClientId),
              eq(clients.studioId, context.studioId)
            )
          );
        if (!client) throw new Error("Client not found");
      }
    }

    // Check for existing requestKey idempotency
    if (parsed.requestKey) {
      const [existingByKey] = await tx
        .select()
        .from(handoffs)
        .where(
          and(
            eq(handoffs.studioId, context.studioId),
            eq(handoffs.requestKey, parsed.requestKey)
          )
        );
      if (existingByKey) {
        return existingByKey;
      }
    }

    // Check for duplicate active pending handoff
    const [existingPending] = await tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.studioId, context.studioId),
          eq(handoffs.entityType, parsed.entityType),
          eq(handoffs.entityId, parsed.entityId),
          eq(handoffs.status, "PENDING")
        )
      )
      .for("update");

    if (existingPending) {
      if (parsed.requestKey && existingPending.requestKey === parsed.requestKey) {
        return existingPending;
      }
      throw new Error("An active pending handoff already exists for this entity");
    }

    const [inserted] = await tx
      .insert(handoffs)
      .values({
        studioId: context.studioId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        clientId: resolvedClientId,
        cycleId: resolvedCycleId,
        conversationId: resolvedConversationId,
        appointmentId: resolvedAppointmentId,
        fromUserId: parsed.fromUserId ?? context.userId,
        toUserId: parsed.toUserId,
        sourceType: parsed.sourceType,
        reasonCode: parsed.reasonCode,
        reasonText: parsed.reasonText ?? null,
        status: "PENDING",
        priority: parsed.priority,
        dueAt: parsed.dueAt ?? null,
        requestKey: parsed.requestKey ?? null,
        metadata: parsed.metadata ?? null,
        createdById: context.userId,
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "handoff_created",
      entityType: "handoff",
      entityId: inserted.id,
      before: null,
      after: {
        id: inserted.id,
        entityType: inserted.entityType,
        entityId: inserted.entityId,
        fromUserId: inserted.fromUserId,
        toUserId: inserted.toUserId,
        status: inserted.status,
        priority: inserted.priority,
        reasonCode: inserted.reasonCode,
        sourceType: inserted.sourceType,
      },
      reason: parsed.reasonText || parsed.reasonCode,
      reasonSource: parsed.sourceType === "HUMAN" ? "user" : "command",
    });

    return inserted;
  });
}

/**
 * Accepts a pending handoff responsibility.
 */
export async function acceptHandoff(
  dbExecutor: any,
  context: HandoffContext,
  input: AcceptHandoffInput
): Promise<typeof handoffs.$inferSelect> {
  const parsed = acceptHandoffSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const [handoff] = await tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.id, parsed.handoffId),
          eq(handoffs.studioId, context.studioId)
        )
      )
      .for("update");

    if (!handoff) {
      throw new Error("Handoff not found");
    }

    if (handoff.status === "ACCEPTED") {
      return handoff;
    }

    if (handoff.status !== "PENDING") {
      throw new Error(`Cannot accept handoff in status ${handoff.status}`);
    }

    const isAssignee = handoff.toUserId === context.userId;
    const canAccept = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_ACCEPT"
    );
    const canOverride = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_OVERRIDE"
    );

    if (!((isAssignee && canAccept) || canOverride)) {
      throw new Error(
        "Permission denied: only intended assignee or override role can accept this handoff"
      );
    }

    const prevStatus = handoff.status;
    const now = new Date();

    const [updated] = await tx
      .update(handoffs)
      .set({
        status: "ACCEPTED",
        acceptedAt: now,
        acceptedById: context.userId,
        updatedAt: now,
      })
      .where(eq(handoffs.id, handoff.id))
      .returning();

    // If target is conversation or has conversationId, update conversation's assignedUserId
    const convId =
      handoff.conversationId ??
      (handoff.entityType === "CONVERSATION" ? handoff.entityId : null);
    if (convId) {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, convId),
            eq(conversations.studioId, context.studioId)
          )
        )
        .for("update");

      if (conv) {
        const prevAssigned = conv.assignedUserId;
        await tx
          .update(conversations)
          .set({
            assignedUserId: handoff.toUserId,
            updatedAt: now,
          })
          .where(eq(conversations.id, conv.id));

        await writeAudit(tx, {
          studioId: context.studioId,
          userId: context.userId,
          action: "conversation_assigned",
          entityType: "conversation",
          entityId: conv.id,
          before: { assignedUserId: prevAssigned },
          after: { assignedUserId: handoff.toUserId },
          reason: `Handoff ${handoff.id} accepted`,
          reasonSource: "user",
        });
      }
    }

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "handoff_accepted",
      entityType: "handoff",
      entityId: handoff.id,
      before: { status: prevStatus, acceptedAt: null, acceptedById: null },
      after: {
        status: "ACCEPTED",
        acceptedAt: now.toISOString(),
        acceptedById: context.userId,
      },
      reason: "Handoff accepted",
      reasonSource: "user",
    });

    return updated;
  });
}

/**
 * Rejects a pending handoff with an explicit reason.
 */
export async function rejectHandoff(
  dbExecutor: any,
  context: HandoffContext,
  input: RejectHandoffInput
): Promise<typeof handoffs.$inferSelect> {
  const parsed = rejectHandoffSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const [handoff] = await tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.id, parsed.handoffId),
          eq(handoffs.studioId, context.studioId)
        )
      )
      .for("update");

    if (!handoff) {
      throw new Error("Handoff not found");
    }

    if (handoff.status === "REJECTED") {
      return handoff;
    }

    if (handoff.status !== "PENDING") {
      throw new Error(`Cannot reject handoff in status ${handoff.status}`);
    }

    const isAssignee = handoff.toUserId === context.userId;
    const canAccept = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_ACCEPT"
    );
    const canOverride = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_OVERRIDE"
    );

    if (!((isAssignee && canAccept) || canOverride)) {
      throw new Error(
        "Permission denied: only intended assignee or override role can reject this handoff"
      );
    }

    const prevStatus = handoff.status;
    const now = new Date();

    const [updated] = await tx
      .update(handoffs)
      .set({
        status: "REJECTED",
        rejectedAt: now,
        rejectedById: context.userId,
        rejectionReason: parsed.reason,
        updatedAt: now,
      })
      .where(eq(handoffs.id, handoff.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "handoff_rejected",
      entityType: "handoff",
      entityId: handoff.id,
      before: {
        status: prevStatus,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
      after: {
        status: "REJECTED",
        rejectedAt: now.toISOString(),
        rejectedById: context.userId,
        rejectionReason: parsed.reason,
      },
      reason: parsed.reason,
      reasonSource: "user",
    });

    return updated;
  });
}

/**
 * Cancels a pending handoff.
 */
export async function cancelHandoff(
  dbExecutor: any,
  context: HandoffContext,
  input: CancelHandoffInput
): Promise<typeof handoffs.$inferSelect> {
  const parsed = cancelHandoffSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const [handoff] = await tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.id, parsed.handoffId),
          eq(handoffs.studioId, context.studioId)
        )
      )
      .for("update");

    if (!handoff) {
      throw new Error("Handoff not found");
    }

    if (handoff.status === "CANCELLED") {
      return handoff;
    }

    if (handoff.status !== "PENDING") {
      throw new Error(`Cannot cancel handoff in status ${handoff.status}`);
    }

    const isCreator = handoff.createdById === context.userId;
    const canCreate = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_CREATE"
    );
    const canOverride = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_OVERRIDE"
    );
    const isAutomationManage = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "AUTOMATION_MANAGE"
    );

    if (
      !(
        (isCreator && canCreate) ||
        canOverride ||
        (handoff.sourceType === "AUTOMATION" && isAutomationManage)
      )
    ) {
      throw new Error("Permission denied: cannot cancel this handoff");
    }

    const prevStatus = handoff.status;
    const now = new Date();
    const reason = parsed.reason || "Handoff cancelled";

    const [updated] = await tx
      .update(handoffs)
      .set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledById: context.userId,
        cancellationReason: reason,
        updatedAt: now,
      })
      .where(eq(handoffs.id, handoff.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "handoff_cancelled",
      entityType: "handoff",
      entityId: handoff.id,
      before: {
        status: prevStatus,
        cancelledAt: null,
        cancelledById: null,
        cancellationReason: null,
      },
      after: {
        status: "CANCELLED",
        cancelledAt: now.toISOString(),
        cancelledById: context.userId,
        cancellationReason: reason,
      },
      reason,
      reasonSource: "user",
    });

    return updated;
  });
}

/**
 * Completes an operational handoff.
 */
export async function completeHandoff(
  dbExecutor: any,
  context: HandoffContext,
  input: CompleteHandoffInput
): Promise<typeof handoffs.$inferSelect> {
  const parsed = completeHandoffSchema.parse(input);

  return executeInTransaction(dbExecutor, async (tx) => {
    await lockStudioAccess(tx, context);

    const [handoff] = await tx
      .select()
      .from(handoffs)
      .where(
        and(
          eq(handoffs.id, parsed.handoffId),
          eq(handoffs.studioId, context.studioId)
        )
      )
      .for("update");

    if (!handoff) {
      throw new Error("Handoff not found");
    }

    if (handoff.status === "COMPLETED") {
      return handoff;
    }

    if (handoff.status !== "ACCEPTED" && handoff.status !== "PENDING") {
      throw new Error(`Cannot complete handoff in status ${handoff.status}`);
    }

    const isAssigneeOrAcceptor =
      handoff.toUserId === context.userId ||
      handoff.acceptedById === context.userId;
    const canAccept = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_ACCEPT"
    );
    const canOverride = await hasPermission(
      tx,
      context.userId,
      context.studioId,
      "HANDOFF_OVERRIDE"
    );

    if (!((isAssigneeOrAcceptor && canAccept) || canOverride)) {
      throw new Error("Permission denied: cannot complete this handoff");
    }

    const prevStatus = handoff.status;
    const now = new Date();

    const [updated] = await tx
      .update(handoffs)
      .set({
        status: "COMPLETED",
        completedAt: now,
        completedById: context.userId,
        updatedAt: now,
      })
      .where(eq(handoffs.id, handoff.id))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "handoff_completed",
      entityType: "handoff",
      entityId: handoff.id,
      before: { status: prevStatus, completedAt: null, completedById: null },
      after: {
        status: "COMPLETED",
        completedAt: now.toISOString(),
        completedById: context.userId,
      },
      reason: parsed.notes || "Operational responsibility handled",
      reasonSource: "user",
    });

    return updated;
  });
}
