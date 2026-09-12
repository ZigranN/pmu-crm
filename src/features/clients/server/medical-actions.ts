"use server";

import { upsertMedicalProfileAction } from "@/features/medical/server/actions";
import { medicalProfileSchema, type MedicalProfileSchema } from "../schemas/medical-profile.schema";

// Keep the existing form action contract; all writes use the same guarded command.
export async function updateMedicalProfileAction(clientId: string, input: MedicalProfileSchema) {
  return upsertMedicalProfileAction(clientId, medicalProfileSchema.parse(input));
}
