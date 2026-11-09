"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { automationRules, automationExecutions, outboxJobs } from "@/db/schema";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/server/services/audit-log.service";
import {
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
} from "../domain/types";
import { validateRuleConfig } from "../domain/validation";
import { DEFAULT_AUTOMATION_RULES } from "../domain/defaults";
import { processAutomationJobs } from "./worker";

export async function createAutomationRuleAction(rawInput: unknown) {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation rules");
  }

  const parsed = createAutomationRuleSchema.parse(rawInput);
  const validatedConfig = validateRuleConfig(parsed.triggerType, parsed.actionType, parsed.config);

  const rule = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(automationRules)
      .values({
        studioId: context.studioId,
        code: parsed.code,
        name: parsed.name,
        description: parsed.description ?? null,
        enabled: parsed.enabled,
        triggerType: parsed.triggerType,
        actionType: parsed.actionType,
        config: validatedConfig,
        createdById: context.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "automation_rule_created",
      entityType: "automation_rule",
      entityId: inserted.id,
      before: null,
      after: {
        id: inserted.id,
        code: inserted.code,
        name: inserted.name,
        triggerType: inserted.triggerType,
        actionType: inserted.actionType,
        enabled: inserted.enabled,
      },
      reason: "Создано правило автоматизации",
      reasonSource: "user",
    });

    return inserted;
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true, rule };
}

export async function updateAutomationRuleAction(rawInput: unknown) {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation rules");
  }

  const parsed = updateAutomationRuleSchema.parse(rawInput);

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, parsed.ruleId),
          eq(automationRules.studioId, context.studioId)
        )
      );

    if (!existing) {
      throw new Error("Правило автоматизации не найдено");
    }

    const actionType = parsed.actionType ?? existing.actionType;
    const configToValidate = parsed.config ?? (existing.config as Record<string, unknown>);
    const validatedConfig = validateRuleConfig(existing.triggerType, actionType, configToValidate);

    const [row] = await tx
      .update(automationRules)
      .set({
        name: parsed.name ?? existing.name,
        description: parsed.description !== undefined ? parsed.description : existing.description,
        enabled: parsed.enabled !== undefined ? parsed.enabled : existing.enabled,
        actionType,
        config: validatedConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationRules.id, parsed.ruleId),
          eq(automationRules.studioId, context.studioId)
        )
      )
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "automation_rule_updated",
      entityType: "automation_rule",
      entityId: row.id,
      before: {
        name: existing.name,
        enabled: existing.enabled,
        actionType: existing.actionType,
        config: existing.config as Record<string, unknown>,
      },
      after: {
        name: row.name,
        enabled: row.enabled,
        actionType: row.actionType,
        config: row.config as Record<string, unknown>,
      },
      reason: "Обновлено правило автоматизации",
      reasonSource: "user",
    });

    return row;
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true, rule: updated };
}

export async function toggleAutomationRuleAction(ruleId: string, enabled: boolean) {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation rules");
  }

  const updated = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.id, ruleId),
          eq(automationRules.studioId, context.studioId)
        )
      );

    if (!existing) {
      throw new Error("Правило автоматизации не найдено");
    }

    const [row] = await tx
      .update(automationRules)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationRules.id, ruleId),
          eq(automationRules.studioId, context.studioId)
        )
      )
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: enabled ? "automation_rule_enabled" : "automation_rule_disabled",
      entityType: "automation_rule",
      entityId: row.id,
      before: { enabled: existing.enabled },
      after: { enabled: row.enabled },
      reason: enabled ? "Правило автоматизации включено" : "Правило автоматизации выключено",
      reasonSource: "user",
    });

    return row;
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true, rule: updated };
}

export async function seedDefaultRulesAction() {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation rules");
  }

  const count = await db.transaction(async (tx) => {
    let created = 0;
    for (const def of DEFAULT_AUTOMATION_RULES) {
      const validatedConfig = validateRuleConfig(def.triggerType, def.actionType, def.config);

      const [rule] = await tx
        .insert(automationRules)
        .values({
          studioId: context.studioId,
          code: def.code,
          name: def.name,
          description: def.description,
          enabled: def.enabled,
          triggerType: def.triggerType,
          actionType: def.actionType,
          config: validatedConfig,
          createdById: context.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [automationRules.studioId, automationRules.code],
        })
        .returning();

      if (rule) {
        created++;
        await writeAudit(tx, {
          studioId: context.studioId,
          userId: context.userId,
          action: "automation_rule_created",
          entityType: "automation_rule",
          entityId: rule.id,
          before: null,
          after: { id: rule.id, code: rule.code, name: rule.name },
          reason: "Создано стандартное правило автоматизации",
          reasonSource: "user",
        });
      }
    }
    return created;
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true, count };
}

export async function retryAutomationJobAction(jobId: string) {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation jobs");
  }

  const updatedJob = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(outboxJobs)
      .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.studioId, context.studioId)));

    if (!job) {
      throw new Error("Фоновая задача не найдена");
    }

    const [row] = await tx
      .update(outboxJobs)
      .set({
        state: "pending",
        availableAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        attempts: 0,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.studioId, context.studioId)))
      .returning();

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "automation_job_retried",
      entityType: "outbox_job",
      entityId: jobId,
      before: { state: job.state, attempts: job.attempts, lastError: job.lastError },
      after: { state: row.state, attempts: 0 },
      reason: "Повторный запуск задачи вручную",
      reasonSource: "user",
    });

    return row;
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true, job: updatedJob };
}

export async function cancelAutomationJobAction(jobId: string) {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_MANAGE");
  if (!allowed) {
    throw new Error("Permission denied: cannot manage automation jobs");
  }

  await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(outboxJobs)
      .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.studioId, context.studioId)));

    if (!job) {
      throw new Error("Фоновая задача не найдена");
    }

    await tx
      .update(outboxJobs)
      .set({
        state: "dead",
        lastError: "manually_cancelled_by_staff",
        updatedAt: new Date(),
      })
      .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.studioId, context.studioId)));

    await tx
      .update(automationExecutions)
      .set({
        status: "cancelled",
        lastError: "manually_cancelled_by_staff",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(automationExecutions.jobId, jobId),
          eq(automationExecutions.studioId, context.studioId)
        )
      );

    await writeAudit(tx, {
      studioId: context.studioId,
      userId: context.userId,
      action: "automation_job_cancelled",
      entityType: "outbox_job",
      entityId: jobId,
      before: { state: job.state },
      after: { state: "dead" },
      reason: "Отмена задачи персоналом",
      reasonSource: "user",
    });
  });

  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return { success: true };
}

export async function processAutomationJobsAction() {
  const context = await requireBrowserStudioContext();
  const allowed = await hasPermission(db, context.userId, context.studioId, "AUTOMATION_READ");
  if (!allowed) {
    throw new Error("Permission denied");
  }

  const result = await processAutomationJobs({ batchSize: 20 });
  revalidatePath("/automations");
  revalidatePath("/settings/automations");
  return result;
}
