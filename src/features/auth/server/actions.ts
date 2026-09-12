"use server";

import { readSession, currentStudioForSessionUser } from "@/server/auth/context";

export async function getSession() {
  return readSession();
}

export async function getCurrentStudioId(userId: string) {
  return currentStudioForSessionUser(userId);
}
