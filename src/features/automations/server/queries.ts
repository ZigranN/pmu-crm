import "server-only";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  automationRules,
  automationExecutions,
  outboxJobs,
  user,
  type AutomationExecutionStatus,
} from "@/db/schema";
import { sensitiveRead } from "@/server/services/access-log.service";

export interface AutomationRuleWithStats {
  id: string;
  studioId: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: string;
  actionType: string;
  config: Record<string, unknown>;
  createdById: string | null;
  createdByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  executionCount: number;
  lastExecutedAt: Date | null;
}

export interface AutomationJobItem {
  id: string;
  studioId: string;
  eventKey: string;
  handler: string;
  state: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  executionId?: string;
  ruleCode?: string;
  ruleName?: string;
  entityType?: string;
  entityId?: string;
}

export interface AutomationExecutionItem {
  id: string;
  studioId: string;
  ruleId: string | null;
  ruleName?: string | null;
  ruleCode?: string | null;
  jobId: string | null;
  triggerType: string;
  actionType: string;
  entityType: string;
  entityId: string;
  status: AutomationExecutionStatus;
  attemptCount: number;
  scheduledFor: Date;
  executedAt: Date | null;
  result: Record<string, unknown> | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationStatsSummary {
  totalRules: number;
  activeRules: number;
  pendingJobs: number;
  failedJobs: number;
  succeededExecutions: number;
  totalExecutions: number;
}

/**
 * Returns all automation rules for the studio with execution statistics.
 */
export async function getAutomationRules(): Promise<AutomationRuleWithStats[]> {
  return sensitiveRead(
    "AUTOMATION_READ",
    undefined,
    { operation: "automations.list" },
    async (context) => {
      const studioId = context.studioId;

      const rules = await db
        .select({
          id: automationRules.id,
          studioId: automationRules.studioId,
          code: automationRules.code,
          name: automationRules.name,
          description: automationRules.description,
          enabled: automationRules.enabled,
          triggerType: automationRules.triggerType,
          actionType: automationRules.actionType,
          config: automationRules.config,
          createdById: automationRules.createdById,
          createdByName: user.name,
          createdAt: automationRules.createdAt,
          updatedAt: automationRules.updatedAt,
        })
        .from(automationRules)
        .leftJoin(user, eq(automationRules.createdById, user.id))
        .where(eq(automationRules.studioId, studioId))
        .orderBy(desc(automationRules.createdAt));

      if (rules.length === 0) {
        return [];
      }

      const ruleIds = rules.map((r) => r.id);

      // Aggregate execution counts and last executed timestamp
      const stats = await db
        .select({
          ruleId: automationExecutions.ruleId,
          count: sql<number>`count(*)::int`,
          lastExecutedAt: sql<Date | null>`max(${automationExecutions.executedAt})`,
        })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.studioId, studioId),
            inArray(automationExecutions.ruleId, ruleIds)
          )
        )
        .groupBy(automationExecutions.ruleId);

      const statsMap = new Map(stats.map((s) => [s.ruleId, s]));

      return rules.map((r) => {
        const stat = statsMap.get(r.id);
        return {
          ...r,
          config: r.config as Record<string, unknown>,
          executionCount: stat?.count ?? 0,
          lastExecutedAt: stat?.lastExecutedAt ? new Date(stat.lastExecutedAt) : null,
        };
      });
    },
    (results) => results.map((r) => r.id)
  );
}

/**
 * Returns a single automation rule by ID.
 */
export async function getAutomationRuleById(ruleId: string): Promise<AutomationRuleWithStats | null> {
  return sensitiveRead(
    "AUTOMATION_READ",
    undefined,
    { operation: "automations.read" },
    async (context) => {
      const [rule] = await db
        .select({
          id: automationRules.id,
          studioId: automationRules.studioId,
          code: automationRules.code,
          name: automationRules.name,
          description: automationRules.description,
          enabled: automationRules.enabled,
          triggerType: automationRules.triggerType,
          actionType: automationRules.actionType,
          config: automationRules.config,
          createdById: automationRules.createdById,
          createdByName: user.name,
          createdAt: automationRules.createdAt,
          updatedAt: automationRules.updatedAt,
        })
        .from(automationRules)
        .leftJoin(user, eq(automationRules.createdById, user.id))
        .where(
          and(
            eq(automationRules.id, ruleId),
            eq(automationRules.studioId, context.studioId)
          )
        );

      if (!rule) return null;

      const [stat] = await db
        .select({
          count: sql<number>`count(*)::int`,
          lastExecutedAt: sql<Date | null>`max(${automationExecutions.executedAt})`,
        })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.studioId, context.studioId),
            eq(automationExecutions.ruleId, rule.id)
          )
        );

      return {
        ...rule,
        config: rule.config as Record<string, unknown>,
        executionCount: stat?.count ?? 0,
        lastExecutedAt: stat?.lastExecutedAt ? new Date(stat.lastExecutedAt) : null,
      };
    },
    (res) => (res ? [res.id] : [])
  );
}

/**
 * Returns outbox jobs (both automation and general background tasks) for the studio.
 */
export async function getAutomationJobs(filters?: {
  state?: string;
  limit?: number;
}): Promise<AutomationJobItem[]> {
  return sensitiveRead(
    "AUTOMATION_READ",
    undefined,
    { operation: "jobs.list" },
    async (context) => {
      const studioId = context.studioId;
      const limit = Math.min(filters?.limit ?? 50, 100);

      const conditions = [eq(outboxJobs.studioId, studioId)];
      if (filters?.state) {
        conditions.push(eq(outboxJobs.state, filters.state));
      }

      const rows = await db
        .select()
        .from(outboxJobs)
        .where(and(...conditions))
        .orderBy(desc(outboxJobs.availableAt), desc(outboxJobs.createdAt))
        .limit(limit);

      return rows.map((job) => {
        const payload = (job.payload && typeof job.payload === "object" ? job.payload : {}) as Record<string, unknown>;
        return {
          id: job.id,
          studioId: job.studioId,
          eventKey: job.eventKey,
          handler: job.handler,
          state: job.state,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          availableAt: job.availableAt,
          lastError: job.lastError,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          executionId: typeof payload.executionId === "string" ? payload.executionId : undefined,
          ruleCode: typeof payload.ruleCode === "string" ? payload.ruleCode : undefined,
          entityType: typeof payload.entityType === "string" ? payload.entityType : undefined,
          entityId: typeof payload.entityId === "string" ? payload.entityId : undefined,
        };
      });
    },
    (jobs) => jobs.map((j) => j.id)
  );
}

/**
 * Returns automation execution history.
 */
export async function getAutomationExecutions(filters?: {
  ruleId?: string;
  status?: string;
  entityType?: string;
  limit?: number;
}): Promise<AutomationExecutionItem[]> {
  return sensitiveRead(
    "AUTOMATION_READ",
    undefined,
    { operation: "automations.list" },
    async (context) => {
      const studioId = context.studioId;
      const limit = Math.min(filters?.limit ?? 50, 100);

      const conditions = [eq(automationExecutions.studioId, studioId)];
      if (filters?.ruleId) {
        conditions.push(eq(automationExecutions.ruleId, filters.ruleId));
      }
      if (filters?.status) {
        conditions.push(eq(automationExecutions.status, filters.status as AutomationExecutionStatus));
      }
      if (filters?.entityType) {
        conditions.push(eq(automationExecutions.entityType, filters.entityType));
      }

      const rows = await db
        .select({
          id: automationExecutions.id,
          studioId: automationExecutions.studioId,
          ruleId: automationExecutions.ruleId,
          ruleName: automationRules.name,
          ruleCode: automationRules.code,
          jobId: automationExecutions.jobId,
          triggerType: automationExecutions.triggerType,
          actionType: automationExecutions.actionType,
          entityType: automationExecutions.entityType,
          entityId: automationExecutions.entityId,
          status: automationExecutions.status,
          attemptCount: automationExecutions.attemptCount,
          scheduledFor: automationExecutions.scheduledFor,
          executedAt: automationExecutions.executedAt,
          result: automationExecutions.result,
          lastError: automationExecutions.lastError,
          createdAt: automationExecutions.createdAt,
          updatedAt: automationExecutions.updatedAt,
        })
        .from(automationExecutions)
        .leftJoin(automationRules, eq(automationExecutions.ruleId, automationRules.id))
        .where(and(...conditions))
        .orderBy(desc(automationExecutions.scheduledFor), desc(automationExecutions.createdAt))
        .limit(limit);

      return rows.map((r) => ({
        ...r,
        result: r.result as Record<string, unknown> | null,
      }));
    },
    (items) => items.map((i) => i.id)
  );
}

/**
 * Returns summary statistics for automations dashboard.
 */
export async function getAutomationStats(): Promise<AutomationStatsSummary> {
  return sensitiveRead(
    "AUTOMATION_READ",
    undefined,
    { operation: "automations.list" },
    async (context) => {
      const studioId = context.studioId;

      const [ruleCounts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${automationRules.enabled} = true)::int`,
        })
        .from(automationRules)
        .where(eq(automationRules.studioId, studioId));

      const [jobCounts] = await db
        .select({
          pending: sql<number>`count(*) filter (where ${outboxJobs.state} in ('pending', 'processing', 'reconciling'))::int`,
          failed: sql<number>`count(*) filter (where ${outboxJobs.state} in ('dead', 'uncertain'))::int`,
        })
        .from(outboxJobs)
        .where(eq(outboxJobs.studioId, studioId));

      const [execCounts] = await db
        .select({
          succeeded: sql<number>`count(*) filter (where ${automationExecutions.status} = 'succeeded')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(automationExecutions)
        .where(eq(automationExecutions.studioId, studioId));

      return {
        totalRules: ruleCounts?.total ?? 0,
        activeRules: ruleCounts?.active ?? 0,
        pendingJobs: jobCounts?.pending ?? 0,
        failedJobs: jobCounts?.failed ?? 0,
        succeededExecutions: execCounts?.succeeded ?? 0,
        totalExecutions: execCounts?.total ?? 0,
      };
    },
    () => []
  );
}
