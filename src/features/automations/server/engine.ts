import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import {
  automationRules,
  automationExecutions,
  outboxJobs,
  type AutomationTriggerType,
} from "@/db/schema";
import { enqueue } from "@/server/events/outbox";
import { buildAutomationEventKey, validateRuleConfig } from "../domain/validation";
import type { TriggerEvent, AutomationJobPayload } from "../domain/types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface EngineContext {
  studioId: string;
  userId?: string;
}

/**
 * Dispatches an automation trigger event inside the active database transaction.
 * Evaluates active rules for the studio and idempotently enqueues outbox jobs.
 */
export async function dispatchAutomationTrigger(
  tx: Transaction,
  context: EngineContext,
  trigger: TriggerEvent
): Promise<Array<{ executionId: string; ruleId: string; scheduledFor: Date }>> {
  const now = trigger.timestamp ?? new Date();

  // 1. Fetch enabled rules for this studio and trigger type
  const matchingRules = await tx
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.studioId, context.studioId),
        eq(automationRules.triggerType, trigger.type),
        eq(automationRules.enabled, true)
      )
    );

  if (matchingRules.length === 0) {
    return [];
  }

  const scheduledResults: Array<{ executionId: string; ruleId: string; scheduledFor: Date }> = [];

  for (const rule of matchingRules) {
    const validatedConfig = validateRuleConfig(rule.triggerType, rule.actionType, rule.config);

    // 2. Compute execution scheduled timestamp
    let scheduledFor = new Date(now.getTime());

    if ("offsetMinutes" in validatedConfig && typeof validatedConfig.offsetMinutes === "number") {
      const refTime = trigger.referenceTime ?? now;
      scheduledFor = new Date(refTime.getTime() + validatedConfig.offsetMinutes * 60 * 1000);

      // Skip past/expired reminders (e.g. appointment is in 1 hour, but rule is 24 hours before)
      if (validatedConfig.offsetMinutes < 0 && scheduledFor.getTime() < now.getTime() - 5 * 60 * 1000) {
        continue;
      }
    } else if (
      "durationMinutes" in validatedConfig &&
      typeof validatedConfig.durationMinutes === "number"
    ) {
      const refTime = trigger.referenceTime ?? now;
      scheduledFor = new Date(refTime.getTime() + validatedConfig.durationMinutes * 60 * 1000);
    } else if (
      ("delayDays" in validatedConfig && typeof validatedConfig.delayDays === "number") ||
      ("delayHours" in validatedConfig && typeof validatedConfig.delayHours === "number")
    ) {
      const days = (validatedConfig.delayDays as number) || 0;
      const hours = (validatedConfig.delayHours as number) || 0;
      const totalMs = (days * 24 + hours) * 3600 * 1000;
      const refTime = trigger.referenceTime ?? now;
      scheduledFor = new Date(refTime.getTime() + totalMs);
    }

    // 3. Build deterministic event key for deduplication
    const qualifier =
      trigger.version !== undefined
        ? String(trigger.version)
        : trigger.referenceTime
        ? trigger.referenceTime.toISOString()
        : scheduledFor.toISOString();

    const eventKey = buildAutomationEventKey({
      ruleCode: rule.code,
      entityType: trigger.entityType,
      entityId: trigger.entityId,
      qualifier,
    });

    // 4. Construct deterministic payload for outbox deduplication
    const payload: Omit<AutomationJobPayload, "executionId"> = {
      ruleId: rule.id,
      ruleCode: rule.code,
      triggerType: trigger.type,
      actionType: rule.actionType,
      entityType: trigger.entityType,
      entityId: trigger.entityId,
      clientId: trigger.clientId ?? null,
      scheduledFor: scheduledFor.toISOString(),
      config: validatedConfig,
      metadata: trigger.metadata ?? {},
    };

    const outboxJob = await enqueue(
      tx,
      {
        studioId: context.studioId,
        handler: "automation.execute.v1",
        eventKey,
        effectType: "transactional",
        availableAt: scheduledFor,
        maxAttempts: 5,
      },
      JSON.parse(JSON.stringify(payload))
    );

    // 5. Create or find execution row
    const [existingExec] = await tx
      .select()
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.studioId, context.studioId),
          eq(automationExecutions.jobId, outboxJob.id)
        )
      );

    let executionId = existingExec?.id;
    if (!existingExec) {
      const [execution] = await tx
        .insert(automationExecutions)
        .values({
          studioId: context.studioId,
          ruleId: rule.id,
          jobId: outboxJob.id,
          triggerType: trigger.type,
          actionType: rule.actionType,
          entityType: trigger.entityType,
          entityId: trigger.entityId,
          status: "scheduled",
          attemptCount: 0,
          scheduledFor,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      executionId = execution.id;
    }

    scheduledResults.push({
      executionId: executionId!,
      ruleId: rule.id,
      scheduledFor,
    });
  }

  return scheduledResults;
}

/**
 * Cancels pending scheduled jobs and execution records for an entity when
 * business state changes (e.g. appointment cancelled/rescheduled, conversation replied to).
 */
export async function cancelPendingAutomations(
  tx: Transaction,
  studioId: string,
  criteria: {
    entityType: string;
    entityId: string;
    triggerTypes?: AutomationTriggerType[];
    reason?: string;
  }
): Promise<{ cancelledCount: number }> {
  // 1. Find scheduled executions for this entity
  const conditions = [
    eq(automationExecutions.studioId, studioId),
    eq(automationExecutions.entityType, criteria.entityType),
    eq(automationExecutions.entityId, criteria.entityId),
    eq(automationExecutions.status, "scheduled"),
  ];

  if (criteria.triggerTypes && criteria.triggerTypes.length > 0) {
    conditions.push(inArray(automationExecutions.triggerType, criteria.triggerTypes));
  }

  const scheduled = await tx
    .select({ id: automationExecutions.id, jobId: automationExecutions.jobId })
    .from(automationExecutions)
    .where(and(...conditions));

  if (scheduled.length === 0) {
    return { cancelledCount: 0 };
  }

  const executionIds = scheduled.map((s) => s.id);
  const jobIds = scheduled.map((s) => s.jobId).filter(Boolean) as string[];

  // 2. Mark executions as cancelled
  await tx
    .update(automationExecutions)
    .set({
      status: "cancelled",
      lastError: criteria.reason ?? "cancelled_by_business_state_change",
      updatedAt: new Date(),
    })
    .where(inArray(automationExecutions.id, executionIds));

  // 3. Mark linked outbox jobs as dead so worker skips them
  if (jobIds.length > 0) {
    await tx
      .update(outboxJobs)
      .set({
        state: "dead",
        lastError: criteria.reason ?? "cancelled_by_business_state_change",
        updatedAt: new Date(),
      })
      .where(and(eq(outboxJobs.studioId, studioId), inArray(outboxJobs.id, jobIds)));
  }

  return { cancelledCount: executionIds.length };
}
