"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { generateMetaAuthUrl } from "./oauth";
import { disconnectInstagramAccount } from "./service";

/**
 * Generates Meta / Instagram OAuth authorization URL for the current user and studio.
 */
export async function getInstagramAuthUrlAction() {
  const context = await requireBrowserStudioPermission("INTEGRATION_MANAGE");

  const reqHeaders = await headers();
  const host = reqHeaders.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/integrations/instagram/callback`;

  const authUrl = await generateMetaAuthUrl({
    studioId: context.studioId,
    userId: context.userId,
    redirectUri,
  });

  return { authUrl };
}

/**
 * Disconnects an Instagram account for the current studio.
 */
export async function disconnectInstagramAction(connectionId: string) {
  const context = await requireBrowserStudioPermission("INTEGRATION_MANAGE");

  await disconnectInstagramAccount(
    { studioId: context.studioId, userId: context.userId, role: context.role ?? undefined },
    connectionId
  );

  revalidatePath("/settings/integrations/instagram");
  revalidatePath("/settings");
  revalidatePath("/conversations");

  return { success: true };
}
