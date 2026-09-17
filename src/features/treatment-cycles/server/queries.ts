import "server-only";
import { db } from "@/db";
import { hasPermission } from "@/lib/permissions";
import { lockStudioAccess } from "@/server/auth/scopes";
import { sensitiveRead } from "@/server/services/access-log.service";
import { inspectLegacyCycles } from "./legacy-report";
export async function getLegacyCycleReport() {
  return sensitiveRead("STUDIO_MANAGE",undefined,{operation:"cycles.legacy.report"},context=>db.transaction(async tx=>{
    await lockStudioAccess(tx,context);
    if(!await hasPermission(tx,context.userId,context.studioId,"STUDIO_MANAGE")) throw new Error("Permission denied");
    return inspectLegacyCycles(tx,context.studioId);
  }),result=>result.entries.map(row=>row.id));
}
