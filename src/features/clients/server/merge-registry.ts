import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/server/commands/ownership";
// Every direct client FK is classified here. The schema coverage test fails when a new module adds one.
export const MOVABLE_CLIENT_TABLES = ["client_assignments", "client_status_history", "appointments", "procedure_sessions", "media", "consents", "payments", "payment_transactions", "tasks", "notifications", "activity_events", "questionnaire_responses", "reviews", "custom_offers", "client_duplicate_decisions"] as const;
export const SPECIAL_CLIENT_TABLES = ["clients", "client_medical_profiles", "client_merges"] as const;
export async function mergeRelations(tx: Transaction, sourceId: string, targetId: string, studioId: string) {
  const records: Record<string, { id: string; [key: string]: unknown }[]> = {};
  for (const table of [...MOVABLE_CLIENT_TABLES, "client_medical_profiles"]) {
    const result = await tx.execute(sql`select * from ${sql.identifier(table)} where client_id in (${sourceId}::uuid, ${targetId}::uuid) order by id limit 1001 for update`);
    const rows: Record<string, unknown>[] = Array.isArray(result) ? Array.from(result) : (result as unknown as { rows: Record<string, unknown>[] }).rows;
    if (rows.length > 1000) throw new Error("Слишком много связей для одной операции объединения");
    if (table !== "client_medical_profiles" && rows.some(row => row.studio_id !== studioId)) throw new Error("Несогласованная принадлежность связанных записей");
    records[table] = rows.map(row => { if (typeof row.id !== "string") throw new Error("Invalid relation ID"); return { ...row, id: row.id }; });
  }
  return records;
}
