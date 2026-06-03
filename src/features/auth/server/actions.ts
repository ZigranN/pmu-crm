"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import {studioMembers, studios} from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function getSession() {
  return await auth.api.getSession({
    headers: await headers(),
  });
}

export async function getCurrentStudioId(userId: string) {
    const member = await db.query.studioMembers.findFirst({
        where: and(
            eq(studioMembers.userId, userId),
            eq(studioMembers.isActive, true)
        ),
    });

    if (member) {
        return member.studioId;
    }

    const studio = await db.query.studios.findFirst({
        where: eq(studios.isActive, true),
    });

    return studio?.id;
}