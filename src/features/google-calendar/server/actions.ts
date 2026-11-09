"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { googleCalendarConnections, masters } from "@/db/schema";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { generateGoogleAuthUrl } from "./oauth";
import {
  disconnectGoogleCalendar,
  reconcileGoogleCalendarConnection,
} from "./service";

/**
 * Generates Google OAuth authorization URL for the current user/master.
 */
export async function getGoogleAuthUrlAction(input?: { masterId?: string }) {
  const context = await requireBrowserStudioContext();

  const canManage = await hasPermission(
    db,
    context.userId,
    context.studioId,
    "INTEGRATION_MANAGE"
  );

  let targetMasterId = input?.masterId ?? null;

  if (!canManage) {
    // If not admin, check if user is a master and connecting their own account
    const [ownMaster] = await db
      .select({ id: masters.id })
      .from(masters)
      .where(
        and(
          eq(masters.userId, context.userId),
          eq(masters.studioId, context.studioId)
        )
      );

    if (!ownMaster) {
      throw new Error("You do not have permission to manage Google Calendar integrations");
    }

    targetMasterId = ownMaster.id;
  }

  const reqHeaders = await headers();
  const host = reqHeaders.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/integrations/google-calendar/callback`;

  const authUrl = generateGoogleAuthUrl({
    studioId: context.studioId,
    userId: context.userId,
    masterId: targetMasterId,
    redirectUri,
  });

  return { authUrl };
}

/**
 * Disconnects a Google Calendar connection.
 */
export async function disconnectGoogleCalendarAction(connectionId: string) {
  const context = await requireBrowserStudioContext();

  const canManage = await hasPermission(
    db,
    context.userId,
    context.studioId,
    "INTEGRATION_MANAGE"
  );

  const [conn] = await db
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  if (!conn) {
    throw new Error("Connection not found");
  }

  if (!canManage && conn.userId !== context.userId) {
    throw new Error("Forbidden");
  }

  await disconnectGoogleCalendar(
    { studioId: context.studioId, userId: context.userId, role: context.role ?? undefined },
    connectionId
  );

  revalidatePath("/settings/integrations/google-calendar");
  revalidatePath("/calendar");
  revalidatePath("/settings");

  return { success: true };
}

/**
 * Triggers manual reconciliation and sync for a connection.
 */
export async function triggerManualSyncAction(connectionId: string) {
  const context = await requireBrowserStudioContext();

  const canManage = await hasPermission(
    db,
    context.userId,
    context.studioId,
    "INTEGRATION_MANAGE"
  );

  const [conn] = await db
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  if (!conn) {
    throw new Error("Connection not found");
  }

  if (!canManage && conn.userId !== context.userId) {
    throw new Error("Forbidden");
  }

  const result = await reconcileGoogleCalendarConnection(
    { studioId: context.studioId, userId: context.userId, role: context.role ?? undefined },
    connectionId
  );

  revalidatePath("/settings/integrations/google-calendar");
  revalidatePath("/calendar");

  return { success: true, result };
}

/**
 * Updates synchronization direction (two_way vs outbound_only).
 */
export async function updateSyncDirectionAction(
  connectionId: string,
  syncDirection: "two_way" | "outbound_only"
) {
  const context = await requireBrowserStudioContext();

  const canManage = await hasPermission(
    db,
    context.userId,
    context.studioId,
    "INTEGRATION_MANAGE"
  );

  const [conn] = await db
    .select()
    .from(googleCalendarConnections)
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  if (!conn) {
    throw new Error("Connection not found");
  }

  if (!canManage && conn.userId !== context.userId) {
    throw new Error("Forbidden");
  }

  await db
    .update(googleCalendarConnections)
    .set({
      syncDirection,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(googleCalendarConnections.id, connectionId),
        eq(googleCalendarConnections.studioId, context.studioId)
      )
    );

  revalidatePath("/settings/integrations/google-calendar");

  return { success: true };
}
