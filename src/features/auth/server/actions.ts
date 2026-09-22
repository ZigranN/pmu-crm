"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ACTIVE_STUDIO_COOKIE,
  readSession,
  requireAuthenticatedUser,
  requireActiveStudioMembership,
  getUserActiveStudios,
  currentStudioForSessionUser,
} from "@/server/auth/context";

export async function getSession() {
  return readSession();
}

/**
 * @deprecated Transitional legacy helper.
 */
export async function getCurrentStudioId(userId: string) {
  return currentStudioForSessionUser(userId);
}

export async function setActiveStudioAction(studioId: string) {
  const user = await requireAuthenticatedUser();
  if (!studioId || !z.string().uuid().safeParse(studioId).success) {
    throw new Error("INVALID_STUDIO_ID");
  }

  // Authoritative server-side validation of active membership in active studio
  const context = await requireActiveStudioMembership(user.id, studioId);

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_STUDIO_COOKIE, context.studioId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  revalidatePath("/", "layout");
  return { success: true, studioId: context.studioId, studioName: context.studioName };
}

export async function clearActiveStudioAction() {
  await requireAuthenticatedUser();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_STUDIO_COOKIE);
  revalidatePath("/", "layout");
  return { success: true };
}

export async function getActiveStudiosAction() {
  const user = await requireAuthenticatedUser();
  return getUserActiveStudios(user.id);
}
