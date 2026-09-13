import "server-only";
import { canonicalClientId } from "@/features/clients/server/identity";
import { z } from "zod";
import { PermanentJobError, type Registry } from "./worker";
// Versioned internal consumer records acceptance in eventInbox. Actual business
// automations/channel adapters are added in their roadmap phases, not simulated here.
export const handlers: Registry = Object.freeze({
  "client.created.v1": {
    kind: "transactional",
    async run(_tx, job) {
      const parsed = z.object({ clientId: z.string().uuid() }).strict().safeParse(job.payload);
      if (!parsed.success) throw new PermanentJobError();
      return { clientId: await canonicalClientId(parsed.data.clientId, job.studioId, _tx), originalClientId: parsed.data.clientId };
    },
  },
});
