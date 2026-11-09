import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { medicalProfileRevisions } from "@/db/schema";
import { entityId, type Transaction } from "@/server/commands/ownership";
import type { MedicalProfileSchema } from "../schemas/medical-profile.schema";

type Executor = typeof db | Transaction;
export type MedicalProfileRevision = typeof medicalProfileRevisions.$inferSelect;

// Clinical fields of medicalProfileSchema, in a fixed order. Persisted text columns are nullable, booleans are NOT NULL default false.
const TEXT_FIELDS = ["allergies", "contraindications", "skinType", "pregnancyStatus", "medications", "previousPMUNotes", "medicalNotes"] as const;
const BOOLEAN_FIELDS = ["previousPMU", "herpesHistory", "diabetes", "bloodThinners", "keloidRisk", "autoimmuneDiseases", "recentBotoxFillers", "recentPeelingLaser", "skinSensitivity"] as const;
export const MEDICAL_PROFILE_SNAPSHOT_FIELDS = [...TEXT_FIELDS, ...BOOLEAN_FIELDS] as const;

export type MedicalProfileSnapshot =
  { [K in typeof TEXT_FIELDS[number]]: string | null } &
  { [K in typeof BOOLEAN_FIELDS[number]]: boolean };

// Mirrors persisted semantics only: missing text -> NULL, missing boolean -> false. Strings are stored verbatim.
export function normalizeMedicalProfileSnapshot(source: Partial<Record<string, unknown>>): MedicalProfileSnapshot {
  const snapshot = {} as Record<string, string | boolean | null>;
  for (const field of TEXT_FIELDS) {
    const value = source[field];
    snapshot[field] = typeof value === "string" ? value : null;
  }
  for (const field of BOOLEAN_FIELDS) snapshot[field] = source[field] === true;
  return snapshot as MedicalProfileSnapshot;
}

// The legacy upsert writes only keys present in the validated input; omitted keys keep their persisted value.
export function projectMedicalProfileSnapshot(current: Partial<Record<string, unknown>> | null | undefined, input: MedicalProfileSchema): MedicalProfileSnapshot {
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return normalizeMedicalProfileSnapshot({ ...(current ?? {}), ...defined });
}

export function hasMedicalProfileChanges(previous: MedicalProfileSnapshot | null | undefined, next: MedicalProfileSnapshot) {
  if (!previous) return true;
  return MEDICAL_PROFILE_SNAPSHOT_FIELDS.some(field => previous[field] !== next[field]);
}

export async function getLatestMedicalProfileRevision(studioId: string, clientId: string, executor: Executor = db): Promise<MedicalProfileRevision | undefined> {
  entityId.parse(studioId); entityId.parse(clientId);
  const [latest] = await executor.select().from(medicalProfileRevisions)
    .where(and(eq(medicalProfileRevisions.studioId, studioId), eq(medicalProfileRevisions.clientId, clientId)))
    .orderBy(desc(medicalProfileRevisions.revisionNumber)).limit(1);
  return latest;
}

export async function getMedicalProfileRevisions(studioId: string, clientId: string, executor: Executor = db): Promise<MedicalProfileRevision[]> {
  entityId.parse(studioId); entityId.parse(clientId);
  return executor.select().from(medicalProfileRevisions)
    .where(and(eq(medicalProfileRevisions.studioId, studioId), eq(medicalProfileRevisions.clientId, clientId)))
    .orderBy(asc(medicalProfileRevisions.revisionNumber));
}

export async function getMedicalProfileRevisionById(studioId: string, revisionId: string, executor: Executor = db): Promise<MedicalProfileRevision | undefined> {
  entityId.parse(studioId); entityId.parse(revisionId);
  const [revision] = await executor.select().from(medicalProfileRevisions)
    .where(and(eq(medicalProfileRevisions.id, revisionId), eq(medicalProfileRevisions.studioId, studioId)));
  return revision;
}

// Append-only. The caller MUST hold the client row lock (lockClient -> SELECT ... FOR UPDATE) in this transaction:
// every medical write for a client takes that lock first, so same-client allocations are serialized and the
// latest number read here cannot change before insert. UNIQUE(client_id, revision_number) remains the final guard.
export async function createMedicalProfileRevision(tx: Transaction, input: { studioId: string; clientId: string; snapshot: MedicalProfileSnapshot; createdById: string | null }) {
  const latest = await getLatestMedicalProfileRevision(input.studioId, input.clientId, tx);
  const [revision] = await tx.insert(medicalProfileRevisions).values({
    studioId: input.studioId, clientId: input.clientId, revisionNumber: (latest?.revisionNumber ?? 0) + 1,
    snapshot: normalizeMedicalProfileSnapshot(input.snapshot), createdById: input.createdById,
  }).returning();
  return revision;
}
