"use server";

import { z } from "zod";
import { db } from "@/db";
import {
  outboxJobs,
  automationExecutions,
  googleCalendarConnections,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { lockStudioAccess } from "@/server/auth/scopes";
import { writeAudit } from "@/server/services/audit-log.service";
import { handlers } from "@/server/events/registry";
import { revalidatePath } from "next/cache";

const retryInputSchema = z
  .object({
    id: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export async function retryOutboxJob(input: { id: string; reason: string }) {
  const data = retryInputSchema.parse(input);
  const context = await requireBrowserStudioContext();

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER", "ADMIN"].includes(actor.role)) {
      throw new Error("Permission denied");
    }

    const [job] = await tx
      .select()
      .from(outboxJobs)
      .where(and(eq(outboxJobs.id, data.id), eq(outboxJobs.studioId, context.studioId)))
      .for("update");

    if (!job || !["dead", "uncertain"].includes(job.state)) {
      throw new Error("Job is already processed or does not require retry");
    }

    if (!Object.hasOwn(handlers, job.handler)) {
      throw new Error("Handler is unavailable in registry");
    }

    const nextState = job.state === "uncertain" ? "uncertain" : "pending";

    await tx
      .update(outboxJobs)
      .set({
        state: nextState,
        attempts: 0,
        availableAt: sql`now()`,
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(outboxJobs.id, job.id));

    await writeAudit(tx, {
      ...context,
      action: "job_recovered",
      entityType: "outbox_job",
      entityId: job.id,
      before: { state: job.state, attempts: job.attempts },
      after: { state: nextState, attempts: 0 },
      reason: data.reason,
      reasonSource: "user",
    });
  });

  revalidatePath("/operations");
  revalidatePath("/settings/jobs");
  return { success: true };
}

export async function retryAutomationExecution(input: { id: string; reason: string }) {
  const data = retryInputSchema.parse(input);
  const context = await requireBrowserStudioContext();

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER", "ADMIN"].includes(actor.role)) {
      throw new Error("Permission denied");
    }

    const [execution] = await tx
      .select()
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.id, data.id),
          eq(automationExecutions.studioId, context.studioId)
        )
      )
      .for("update");

    if (!execution || execution.status !== "failed") {
      throw new Error("Only failed automation executions can be retried");
    }

    // Reset status to scheduled for re-execution
    await tx
      .update(automationExecutions)
      .set({
        status: "scheduled",
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(automationExecutions.id, execution.id));

    if (execution.jobId) {
      await tx
        .update(outboxJobs)
        .set({
          state: "pending",
          attempts: 0,
          availableAt: sql`now()`,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(outboxJobs.id, execution.jobId),
            eq(outboxJobs.studioId, context.studioId)
          )
        );

      await writeAudit(tx, {
        ...context,
        action: "automation_job_retried",
        entityType: "outbox_job",
        entityId: execution.jobId,
        before: { executionStatus: "failed", jobId: execution.jobId },
        after: { executionStatus: "scheduled", jobId: execution.jobId },
        reason: data.reason,
        reasonSource: "user",
      });
    }
  });

  revalidatePath("/operations");
  revalidatePath("/settings/automations");
  return { success: true };
}

export async function reconcileGoogleCalendarConnection(input: { id: string; reason: string }) {
  const data = retryInputSchema.parse(input);
  const context = await requireBrowserStudioContext();

  await db.transaction(async (tx) => {
    const actor = await lockStudioAccess(tx, context);
    if (!["OWNER", "ADMIN"].includes(actor.role)) {
      throw new Error("Permission denied");
    }

    const [conn] = await tx
      .select()
      .from(googleCalendarConnections)
      .where(
        and(
          eq(googleCalendarConnections.id, data.id),
          eq(googleCalendarConnections.studioId, context.studioId)
        )
      )
      .for("update");

    if (!conn) {
      throw new Error("Google Calendar connection not found");
    }

    // Reset sync status and enqueue a reconcile outbox job
    await tx
      .update(googleCalendarConnections)
      .set({
        syncStatus: "syncing",
        lastError: null,
        updatedAt: sql`now()`,
      })
      .where(eq(googleCalendarConnections.id, conn.id));

    await writeAudit(tx, {
      ...context,
      action: "google_calendar_reconciled",
      entityType: "google_calendar_connection",
      entityId: conn.id,
      before: { syncStatus: conn.syncStatus, status: conn.status },
      after: { syncStatus: "syncing", status: conn.status },
      reason: data.reason,
      reasonSource: "user",
    });
  });

  revalidatePath("/operations");
  revalidatePath("/settings/integrations/google-calendar");
  return { success: true };
}
