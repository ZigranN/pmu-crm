"use server";

import { requireAuthenticatedUser, requireStudioContextFor } from "@/server/auth/context";
import { db } from "@/db";
import { studios } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getStudioById(id: string) {
  const user = await requireAuthenticatedUser();
  try {
    await requireStudioContextFor(user.id, id);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "STUDIO_ACCESS_DENIED" ||
        error.name === "StudioAccessDeniedError")
    ) {
      throw new Error("Permission denied");
    }
    throw error;
  }
  return await db.query.studios.findFirst({
    where: eq(studios.id, id),
  });
}
