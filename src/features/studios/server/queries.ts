"use server";

import { db } from "@/db";
import { studios } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getStudioById(id: string) {
  return await db.query.studios.findFirst({
    where: eq(studios.id, id),
  });
}
