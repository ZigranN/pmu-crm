import "server-only";
import { and, eq } from "drizzle-orm";
import { clients } from "@/db/schema";
import { db } from "@/db";
import type { Transaction } from "@/server/commands/ownership";
// Internal identity lookup, not authorization. Every caller must scope the resolved client.
export async function canonicalClientId(id: string, studioId: string, executor: typeof db | Transaction = db) {
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    if (seen.has(id)) throw new Error("Invalid client alias chain"); seen.add(id);
    const [row] = await executor.select({ id: clients.id, target: clients.mergedIntoId }).from(clients).where(and(eq(clients.id, id), eq(clients.studioId, studioId)));
    if (!row || !row.target) return id;
    id = row.target;
  }
  throw new Error("Client alias chain too long");
}
