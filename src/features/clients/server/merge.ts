import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { clients, masters, clientMedicalProfiles, clientMerges, clientAssignments, clientStatusHistory } from "@/db/schema";
import { lockClient, type Transaction } from "@/server/commands/ownership";
import { hasPermission } from "@/lib/permissions";
import { getStudioRole } from "@/lib/roles";
import { payloadHash, type Json } from "@/server/commands/idempotency";
import { writeAudit } from "@/server/services/audit-log.service";
import { writeActivity } from "@/server/services/activity.service";
import { MERGE_FIELDS, type MergeField, type MergeInput } from "../merge-contract";
import { mergeRelations, MOVABLE_CLIENT_TABLES } from "./merge-registry";
type Context = { userId: string; studioId: string };
const json = (value: unknown): Json => JSON.parse(JSON.stringify(value));
export async function authorizeMerge(tx: Transaction, context: Context) {
  const role = await getStudioRole(tx, context.userId, context.studioId);
  if (role !== "OWNER" && role !== "ADMIN") throw new Error("Permission denied");
  for (const permission of ["CLIENT_READ", "CLIENT_UPDATE", "CLIENT_ARCHIVE"] as const) if (!await hasPermission(tx, context.userId, context.studioId, permission)) throw new Error("Permission denied");
}
export async function inspectMerge(tx: Transaction, context: Context, sourceId: string, targetId: string) {
  await authorizeMerge(tx, context);
  const source = await lockClient(tx, sourceId, context.studioId, context.userId, true, "CLIENT_UPDATE");
  const target = await lockClient(tx, targetId, context.studioId, context.userId, false, "CLIENT_UPDATE");
  if (source.id === target.id || source.mergedIntoId || target.mergedIntoId) throw new Error("Выберите две необъединённые карточки");
  const records = await mergeRelations(tx, sourceId, targetId, context.studioId);
  const aliases = await tx.select().from(clients).where(and(eq(clients.studioId, context.studioId), or(eq(clients.mergedIntoId, sourceId), eq(clients.mergedIntoId, targetId)))).orderBy(clients.id);
  const masterRows = await tx.select({ id: masters.id, name: masters.displayName }).from(masters).where(eq(masters.studioId, context.studioId));
  const fields = (Object.keys(MERGE_FIELDS) as MergeField[]).map(field => ({ field, label: MERGE_FIELDS[field], source: json(source[field]), target: json(target[field]), sourceDisplay: field.endsWith("MasterId") ? masterRows.find(row => row.id === source[field])?.name ?? "Не назначен" : null, targetDisplay: field.endsWith("MasterId") ? masterRows.find(row => row.id === target[field])?.name ?? "Не назначен" : null, conflict: JSON.stringify(source[field]) !== JSON.stringify(target[field]) }));
  const token = payloadHash(json({ context, source, target, records, aliases }));
  const counts = Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, rows.filter(row => row.client_id === source.id).length]));
  const medicalConflict = records.client_medical_profiles.filter(row => row.superseded_at === null).length > 1;
  return { source, target, records, aliases, preview: { sourceId, targetId, sourceName: source.fullName, targetName: target.fullName, token, fields, counts, medicalConflict } };
}
export type MergePreview = Awaited<ReturnType<typeof inspectMerge>>["preview"];
export class StaleMergeReview extends Error {}
export async function executeMerge(tx: Transaction, context: Context, input: MergeInput, commandId: string) {
  const state = await inspectMerge(tx, context, input.sourceId, input.targetId);
  if (state.preview.token !== input.token) throw new StaleMergeReview("Данные изменились: обновите предварительную проверку");
  const { source, target, records } = state;
  const selected: Record<string, unknown> = {}, provenance: Record<string, string> = {};
  for (const row of state.preview.fields) {
    if (row.conflict && !input.choices[row.field]) throw new Error(`Выберите значение: ${row.label}`);
    const origin = input.choices[row.field] === "source" ? source : target;
    selected[row.field] = origin[row.field]; provenance[row.field] = origin.id;
  }
  // Cache totals are additive only; actual payment rows, amounts and historical snapshots never change.
  const changes = { ...selected, fullName: `${selected.firstName} ${selected.lastName || ""}`.trim(),
    ltvCents: source.ltvCents + target.ltvCents, visitCount: source.visitCount + target.visitCount,
    retentionScore: null,
    firstVisitDate: [source.firstVisitDate, target.firstVisitDate].filter((v): v is Date => !!v).sort((a,b) => +a - +b)[0] ?? null,
    lastVisitDate: [source.lastVisitDate, target.lastVisitDate].filter((v): v is Date => !!v).sort((a,b) => +b - +a)[0] ?? null,
    nextVisitDate: [source.nextVisitDate, target.nextVisitDate].filter((v): v is Date => !!v).sort((a,b) => +a - +b)[0] ?? null,
    updatedAt: new Date() };
  const moved: Record<string, string[]> = Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, rows.filter(row => row.client_id === source.id).map(row => row.id)]));
  const [after] = await tx.update(clients).set(changes).where(eq(clients.id, target.id)).returning();
  await tx.update(clients).set({ mergedIntoId: target.id, deletedAt: new Date(), deletedById: context.userId, updatedAt: new Date() }).where(eq(clients.id, source.id));
  await tx.update(clients).set({ mergedIntoId: target.id }).where(and(eq(clients.studioId, context.studioId), eq(clients.mergedIntoId, source.id)));
  const [merge] = await tx.insert(clientMerges).values({ ...context, sourceId: source.id, targetId: target.id, actorId: context.userId, reason: input.reason, reviewToken: input.token,
    sourceSnapshot: json(source), targetSnapshot: json(target), resultSnapshot: json(after), provenance, movedRecords: moved }).returning();

  for (const table of MOVABLE_CLIENT_TABLES) {
    moved[table] = records[table].filter(row => row.client_id === source.id).map(row => row.id);
    await tx.execute(sql`update ${sql.identifier(table)} set client_id = ${target.id}::uuid where client_id = ${source.id}::uuid and studio_id = ${context.studioId}::uuid`);
  }
  const activeSource = records.client_medical_profiles.find(row => row.client_id === source.id && row.superseded_at === null);
  if (state.preview.medicalConflict && activeSource) {
    await tx.update(clientMedicalProfiles).set({ supersededAt: new Date() }).where(eq(clientMedicalProfiles.id, activeSource.id));
    await tx.update(clientMedicalProfiles).set({ mergeReviewRequired: true, updatedAt: new Date() }).where(and(eq(clientMedicalProfiles.clientId, target.id), isNull(clientMedicalProfiles.supersededAt)));
  }
  moved.client_medical_profiles = records.client_medical_profiles.filter(row => row.client_id === source.id).map(row => row.id);
  await tx.update(clientMedicalProfiles).set({ clientId: target.id }).where(eq(clientMedicalProfiles.clientId, source.id));
  if (after.assignedMasterId !== target.assignedMasterId) await tx.insert(clientAssignments).values({ ...context, clientId: target.id, previousMasterId: target.assignedMasterId, masterId: after.assignedMasterId, changedById: context.userId, reason: input.reason });
  if (after.clientStatus !== target.clientStatus) await tx.insert(clientStatusHistory).values({ studioId: context.studioId, clientId: target.id, oldStatus: target.clientStatus, newStatus: after.clientStatus, changedById: context.userId, note: input.reason });
  await writeAudit(tx, { ...context, action: "client_merged", entityType: "client", entityId: target.id, before: { source, target }, after: { client: after, mergeId: merge.id, provenance, moved }, reason: input.reason, reasonSource: "user", metadata: { commandId, sourceId: source.id } });
  await writeActivity(tx, { ...context, clientId: target.id, type: "client_updated", title: "Карточки клиентов объединены", description: input.reason, metadata: { sourceId: source.id, mergeId: merge.id } });
  return { id: target.id, mergeId: merge.id };
}
