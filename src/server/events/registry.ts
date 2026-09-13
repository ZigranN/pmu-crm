import "server-only";
import { canonicalClientId } from "@/features/clients/server/identity";
import { cycleStageHistory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PermanentJobError, type Registry } from "./worker";
// Versioned internal consumer records acceptance in eventInbox. Actual business
// automations/channel adapters are added in their roadmap phases, not simulated here.
export const handlers: Registry = Object.freeze({
  "cycle.stage-recorded.v1": {
    kind: "transactional",
    async run(tx, job) {
      const parsed=z.object({cycleId:z.string().uuid(),version:z.number().int().positive(),commandId:z.string().uuid()}).strict().safeParse(job.payload);
      if(!parsed.success) throw new PermanentJobError();
      const data=parsed.data;
      const [history]=await tx.select().from(cycleStageHistory).where(and(eq(cycleStageHistory.studioId,job.studioId),eq(cycleStageHistory.cycleId,data.cycleId),eq(cycleStageHistory.version,data.version),eq(cycleStageHistory.commandId,data.commandId)));
      if(!history) throw new PermanentJobError();
      // Durable acknowledgement of this version, not the cycle's possibly newer stage.
      // Booking/finance/post-care consumers will subscribe in their respective phases.
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
});
