import "server-only";
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
      return parsed.data;
    },
  },
});
