import "server-only";
import { createFollowUpTask } from "@/features/treatment-cycles/server/followups";
import { createDecisionTask } from "@/features/consultations/server/decision-job";
import { canonicalClientId } from "@/features/clients/server/identity";
import { executeAutomationJob } from "@/features/automations/server/executor";
import { dispatchAutomationTrigger } from "@/features/automations/server/engine";
import {
  syncAppointmentToGoogleCalendar,
  reconcileGoogleCalendarConnection,
} from "@/features/google-calendar/server/service";
import { executePrivacyExport } from "@/features/privacy/server/export-service";
import { executePrivacyAnonymize } from "@/features/privacy/server/anonymization-service";
import { executeRetentionCleanup } from "@/features/privacy/server/retention-service";
import { cycleStageHistory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PermanentJobError, type Registry } from "./worker";
// Versioned internal consumer records acceptance in eventInbox. Actual business
// automations/channel adapters are added in their roadmap phases, not simulated here.
export const handlers: Registry = Object.freeze({
  "cycle.follow-up-due.v1":{kind:"transactional",run:createFollowUpTask},
  "consultation.decision-due.v1":{kind:"transactional",run:createDecisionTask},
  "cycle.stage-recorded.v1": {
    kind: "transactional",
    async run(tx, job) {
      const parsed=z.object({cycleId:z.string().uuid(),version:z.number().int().positive(),commandId:z.string().uuid()}).strict().safeParse(job.payload);
      if(!parsed.success) throw new PermanentJobError();
      const data=parsed.data;
      const [history]=await tx.select().from(cycleStageHistory).where(and(eq(cycleStageHistory.studioId,job.studioId),eq(cycleStageHistory.cycleId,data.cycleId),eq(cycleStageHistory.version,data.version),eq(cycleStageHistory.commandId,data.commandId)));
      if(!history) throw new PermanentJobError();

      // Trigger cycle stage changed automations
      await dispatchAutomationTrigger(tx, { studioId: job.studioId }, {
        type: "TREATMENT_CYCLE_STAGE_CHANGED",
        studioId: job.studioId,
        entityType: "treatment_cycle",
        entityId: data.cycleId,
        version: data.version,
        metadata: { stage: history.toStage, commandId: data.commandId },
      });

      // Durable acknowledgement of this version, not the cycle's possibly newer stage.
      return {cycleId:data.cycleId,historyId:history.id,version:data.version,stage:history.toStage};
    },
  },
  "client.created.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z.object({ clientId: z.string().uuid() }).strict().safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      return { clientId: await canonicalClientId(parsed.data.clientId, job.studioId, _tx), originalClientId: parsed.data.clientId };
    },
  },
  "automation.execute.v1": {
    kind: "transactional",
    async run(tx, job) {
      const res = await executeAutomationJob(tx, job.studioId, job.payload);
      return JSON.parse(JSON.stringify(res));
    },
  },
  "google-calendar.sync-appointment.v1": {
    kind: "transactional",
    async run(tx, job) {
      const parsed = z
        .object({
          appointmentId: z.string().uuid(),
          action: z.enum(["upsert", "delete"]).default("upsert"),
        })
        .strict()
        .safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      const res = await syncAppointmentToGoogleCalendar({
        studioId: job.studioId,
        appointmentId: parsed.data.appointmentId,
        action: parsed.data.action,
        tx,
      });
      return JSON.parse(JSON.stringify(res));
    },
  },
  "google-calendar.delete-appointment.v1": {
    kind: "transactional",
    async run(tx, job) {
      const parsed = z
        .object({
          appointmentId: z.string().uuid(),
        })
        .strict()
        .safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      const res = await syncAppointmentToGoogleCalendar({
        studioId: job.studioId,
        appointmentId: parsed.data.appointmentId,
        action: "delete",
        tx,
      });
      return JSON.parse(JSON.stringify(res));
    },
  },
  "google-calendar.reconcile-connection.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z
        .object({
          connectionId: z.string().uuid(),
        })
        .strict()
        .safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      const res = await reconcileGoogleCalendarConnection(
        { studioId: job.studioId, userId: "system" },
        parsed.data.connectionId
      );
      return JSON.parse(JSON.stringify(res));
    },
  },
  "privacy.execute-export.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z
        .object({
          requestId: z.string().uuid(),
          actorId: z.string().min(1),
        })
        .strict()
        .safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      const res = await executePrivacyExport(
        parsed.data.requestId,
        job.studioId,
        parsed.data.actorId
      );
      return JSON.parse(JSON.stringify(res));
    },
  },
  "privacy.execute-anonymize.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z
        .object({
          requestId: z.string().uuid(),
          actorId: z.string().min(1),
          reason: z.string().optional(),
        })
        .strict()
        .safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      const res = await executePrivacyAnonymize(
        parsed.data.requestId,
        job.studioId,
        parsed.data.actorId,
        parsed.data.reason
      );
      return JSON.parse(JSON.stringify(res));
    },
  },
  "privacy.retention-cleanup.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z
        .object({
          actorId: z.string().optional(),
        })
        .strict()
        .safeParse(job.payload || {});
      const actorId = parsed.success ? (parsed.data.actorId || "system") : "system";
      const res = await executeRetentionCleanup(job.studioId, actorId);
      return JSON.parse(JSON.stringify(res));
    },
  },
});
