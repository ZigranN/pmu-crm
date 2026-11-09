import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
  automationExecutions,
  appointments,
  conversations,
  conversationMessages,
  procedureSessions,
  treatmentCycles,
  tasks,
  studioMembers,
  masters,
  user,
} from "@/db/schema";
import type { AutomationJobPayload, AutomationExecutionResult } from "../domain/types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PermanentAutomationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentAutomationError";
  }
}

/**
 * Executes a claimed automation job payload idempotently inside the worker transaction.
 */
export async function executeAutomationJob(
  tx: Transaction,
  studioId: string,
  rawPayload: unknown,
  jobId?: string
): Promise<AutomationExecutionResult> {
  const payload = rawPayload as AutomationJobPayload;
  const now = new Date();

  // Resolve execution record ID
  let execId = payload.executionId;
  if (!execId && jobId) {
    const [exec] = await tx
      .select({ id: automationExecutions.id })
      .from(automationExecutions)
      .where(and(eq(automationExecutions.studioId, studioId), eq(automationExecutions.jobId, jobId)));
    execId = exec?.id;
  }
  if (!execId && payload.ruleId && payload.entityId) {
    const [exec] = await tx
      .select({ id: automationExecutions.id })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.studioId, studioId),
          eq(automationExecutions.ruleId, payload.ruleId),
          eq(automationExecutions.entityType, payload.entityType),
          eq(automationExecutions.entityId, payload.entityId),
          eq(automationExecutions.status, "scheduled")
        )
      );
    execId = exec?.id;
  }

  // 1. Mark execution as running
  if (execId) {
    await tx
      .update(automationExecutions)
      .set({
        status: "running",
        attemptCount: sql`${automationExecutions.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(automationExecutions.id, execId),
          eq(automationExecutions.studioId, studioId)
        )
      );
  }

  try {
    // 2. Pre-execution validity checks (prevent executing stale/irrelevant actions)
    const validity = await checkEntityValidity(tx, studioId, payload);
    if (!validity.isValid) {
      const skippedResult: AutomationExecutionResult = {
        action: payload.actionType,
        entityType: payload.entityType,
        entityId: payload.entityId,
        status: "skipped",
        reason: validity.reason,
        executedAt: now.toISOString(),
      };

      if (execId) {
        await tx
          .update(automationExecutions)
          .set({
            status: "skipped",
            executedAt: now,
            result: skippedResult as unknown as Record<string, unknown>,
            lastError: validity.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(automationExecutions.id, execId),
              eq(automationExecutions.studioId, studioId)
            )
          );
      }

      return skippedResult;
    }

    // 3. Resolve default assignee for tasks (e.g. master's userId or first active studio owner/admin)
    const assigneeUserId = await resolveAssigneeUserId(tx, studioId, payload, validity);

    // 4. Perform deterministic action
    const createdEntities: Record<string, string> = {};

    switch (payload.actionType) {
      case "CREATE_OPERATIONAL_REMINDER": {
        const title = (payload.config.titleTemplate as string) || "Операционное напоминание";
        const description =
          (payload.config.messageTemplate as string) ||
          (payload.config.descriptionTemplate as string) ||
          `Автоматическое напоминание по правилу ${payload.ruleCode}`;
        const priority =
          ((payload.config.priority as string) as "low" | "normal" | "high" | "urgent") || "normal";

        const [createdTask] = await tx
          .insert(tasks)
          .values({
            studioId,
            assignedToId: assigneeUserId,
            clientId: payload.clientId ?? validity.clientId ?? null,
            appointmentId: payload.entityType === "appointment" ? payload.entityId : null,
            procedureSessionId: payload.entityType === "procedure_session" ? payload.entityId : null,
            title,
            description,
            type: "follow_up",
            status: "pending",
            priority,
            dueAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        createdEntities.taskId = createdTask.id;
        break;
      }

      case "CREATE_CONVERSATION_FOLLOW_UP": {
        const title = (payload.config.titleTemplate as string) || "Неотвеченное сообщение в диалоге";
        const priority =
          ((payload.config.priority as string) as "low" | "normal" | "high" | "urgent") || "high";

        const [createdTask] = await tx
          .insert(tasks)
          .values({
            studioId,
            assignedToId: assigneeUserId,
            clientId: payload.clientId ?? validity.clientId ?? null,
            title,
            description: `Клиент ожидает ответа на входящее сообщение (правило: ${payload.ruleCode})`,
            type: "no_reply",
            status: "pending",
            priority,
            dueAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        createdEntities.taskId = createdTask.id;
        break;
      }

      case "RECORD_INTERNAL_MESSAGE": {
        const convId = payload.entityType === "conversation" ? payload.entityId : null;
        if (!convId) {
          throw new PermanentAutomationError("Cannot record internal message: missing conversation entity");
        }

        const body = `[Автоматическая система: ${payload.ruleCode}] ${
          payload.config.titleTemplate ?? "Напоминание"
        }${payload.config.messageTemplate ? ` — ${payload.config.messageTemplate}` : ""}`;

        const [createdMessage] = await tx
          .insert(conversationMessages)
          .values({
            studioId,
            conversationId: convId,
            clientId: payload.clientId ?? validity.clientId ?? "",
            direction: "OUTBOUND",
            channel: "MANUAL",
            body,
            senderUserId: null, // Clear non-human distinction
            providerMessageId: null, // Strictly provider-neutral
            providerMetadata: {
              isAutomated: true,
              ruleId: payload.ruleId,
              ruleCode: payload.ruleCode,
            },
            sentAt: now,
            receivedAt: now,
            createdAt: now,
          })
          .returning();

        createdEntities.messageId = createdMessage.id;
        break;
      }

      case "SURFACE_NEEDS_ATTENTION": {
        const title = (payload.config.titleTemplate as string) || "Требуется внимание";
        const [createdTask] = await tx
          .insert(tasks)
          .values({
            studioId,
            assignedToId: assigneeUserId,
            clientId: payload.clientId ?? validity.clientId ?? null,
            appointmentId: payload.entityType === "appointment" ? payload.entityId : null,
            procedureSessionId: payload.entityType === "procedure_session" ? payload.entityId : null,
            title,
            description: `Обратите внимание на объект (${payload.entityType}: ${payload.entityId})`,
            type: "follow_up",
            status: "pending",
            priority: "high",
            dueAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        createdEntities.taskId = createdTask.id;
        break;
      }

      default:
        throw new PermanentAutomationError(`Unsupported action type: ${payload.actionType}`);
    }

    const successResult: AutomationExecutionResult = {
      action: payload.actionType,
      entityType: payload.entityType,
      entityId: payload.entityId,
      status: "succeeded",
      createdEntities,
      executedAt: now.toISOString(),
    };

    // 5. Update execution row to succeeded
    if (execId) {
      await tx
        .update(automationExecutions)
        .set({
          status: "succeeded",
          executedAt: now,
          result: successResult as unknown as Record<string, unknown>,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(automationExecutions.id, execId),
            eq(automationExecutions.studioId, studioId)
          )
        );
    }

    return successResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (execId) {
      await tx
        .update(automationExecutions)
        .set({
          status: "failed",
          lastError: errorMsg.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(automationExecutions.id, execId),
            eq(automationExecutions.studioId, studioId)
          )
        );
    }

    throw error;
  }
}

interface ValidityCheckResult {
  isValid: boolean;
  reason?: string;
  clientId?: string | null;
  masterId?: string | null;
  userId?: string | null;
}

async function checkEntityValidity(
  tx: Transaction,
  studioId: string,
  payload: AutomationJobPayload
): Promise<ValidityCheckResult> {
  switch (payload.entityType) {
    case "appointment": {
      const [appt] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, payload.entityId), eq(appointments.studioId, studioId)));

      if (!appt) {
        return { isValid: false, reason: "appointment_not_found" };
      }
      if (appt.status === "cancelled") {
        return { isValid: false, reason: "appointment_cancelled" };
      }

      return {
        isValid: true,
        clientId: appt.clientId,
        masterId: appt.masterId,
      };
    }

    case "conversation": {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, payload.entityId), eq(conversations.studioId, studioId)));

      if (!conv) {
        return { isValid: false, reason: "conversation_not_found" };
      }

      if (conv.status === "CLOSED") {
        return { isValid: false, reason: "conversation_closed" };
      }

      // Check if a staff outbound message was sent after the scheduled time or after trigger
      const triggerTime = payload.metadata?.triggerTime
        ? new Date(payload.metadata.triggerTime as string)
        : conv.createdAt;

      const [newerOutbound] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conv.id),
            eq(conversationMessages.studioId, studioId),
            eq(conversationMessages.direction, "OUTBOUND"),
            gt(conversationMessages.sentAt, triggerTime)
          )
        )
        .limit(1);

      if (newerOutbound) {
        return { isValid: false, reason: "conversation_already_answered_by_staff" };
      }

      return {
        isValid: true,
        clientId: conv.clientId,
        userId: conv.assignedUserId,
      };
    }

    case "procedure_session": {
      const [session] = await tx
        .select()
        .from(procedureSessions)
        .where(
          and(
            eq(procedureSessions.id, payload.entityId),
            eq(procedureSessions.studioId, studioId),
            isNull(procedureSessions.deletedAt)
          )
        );

      if (!session) {
        return { isValid: false, reason: "procedure_session_not_found" };
      }

      if (session.status !== "COMPLETED") {
        return { isValid: false, reason: `procedure_session_not_completed (status: ${session.status})` };
      }

      return {
        isValid: true,
        clientId: session.clientId,
        masterId: session.masterId,
      };
    }

    case "treatment_cycle": {
      const [cycle] = await tx
        .select()
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.id, payload.entityId),
            eq(treatmentCycles.studioId, studioId),
            isNull(treatmentCycles.archivedAt)
          )
        );

      if (!cycle) {
        return { isValid: false, reason: "treatment_cycle_not_found" };
      }

      return {
        isValid: true,
        clientId: cycle.clientId,
      };
    }

    default:
      return { isValid: true };
  }
}

async function resolveAssigneeUserId(
  tx: Transaction,
  studioId: string,
  payload: AutomationJobPayload,
  validity: ValidityCheckResult
): Promise<string> {
  // 1. If validity resolved a direct userId
  if (validity.userId) {
    return validity.userId;
  }

  // 2. If validity resolved a masterId, get master's linked userId
  if (validity.masterId) {
    const [masterRow] = await tx
      .select({ userId: masters.userId })
      .from(masters)
      .where(and(eq(masters.id, validity.masterId), eq(masters.studioId, studioId)));

    if (masterRow?.userId) {
      return masterRow.userId;
    }
  }

  // 3. Fallback: find any active studio member user
  const [member] = await tx
    .select({ userId: studioMembers.userId })
    .from(studioMembers)
    .where(and(eq(studioMembers.studioId, studioId), eq(studioMembers.isActive, true)))
    .limit(1);

  if (member?.userId) {
    return member.userId;
  }

  // 4. Ultimate fallback: find any user
  const [anyUser] = await tx.select({ id: user.id }).from(user).limit(1);
  if (anyUser?.id) {
    return anyUser.id;
  }

  throw new PermanentAutomationError("No valid user exists in system to assign automation task");
}
