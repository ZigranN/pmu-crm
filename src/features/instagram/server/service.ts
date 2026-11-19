import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { instagramConnections, studios } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/encryption";
import type { Transaction } from "@/server/commands/ownership";

export interface ContextWithStudio {
  studioId: string;
  userId: string;
  role?: string;
}

export interface ConnectInstagramAccountInput {
  instagramAccountId: string;
  instagramUsername?: string | null;
  instagramName?: string | null;
  pageId?: string | null;
  pageName?: string | null;
  accessToken: string;
  expiresIn?: number | null;
  scope?: string | null;
}

/**
 * Connects or updates an Instagram account connection for a studio.
 */
export async function connectInstagramAccount(
  context: ContextWithStudio,
  input: ConnectInstagramAccountInput,
  txExecutor: typeof db | Transaction = db
) {
  const encryptedAccessToken = encryptSecret(input.accessToken);
  const tokenExpiresAt = input.expiresIn
    ? new Date(Date.now() + (input.expiresIn - 60) * 1000)
    : null;

  const [connection] = await txExecutor
    .insert(instagramConnections)
    .values({
      studioId: context.studioId,
      userId: context.userId,
      instagramAccountId: input.instagramAccountId,
      instagramUsername: input.instagramUsername ?? null,
      instagramName: input.instagramName ?? null,
      pageId: input.pageId ?? null,
      pageName: input.pageName ?? null,
      encryptedAccessToken,
      tokenExpiresAt,
      scope: input.scope ?? null,
      status: "connected",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        instagramConnections.studioId,
        instagramConnections.instagramAccountId,
      ],
      set: {
        userId: context.userId,
        instagramUsername: input.instagramUsername ?? null,
        instagramName: input.instagramName ?? null,
        pageId: input.pageId ?? null,
        pageName: input.pageName ?? null,
        encryptedAccessToken,
        tokenExpiresAt,
        scope: input.scope ?? null,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  // If studio doesn't have an instagram handle set or we can update it to matched username
  if (input.instagramUsername) {
    const handle = `@${input.instagramUsername.replace(/^@/, "")}`;
    await txExecutor
      .update(studios)
      .set({
        instagram: handle,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(studios.id, context.studioId),
          eq(studios.instagram, "")
        )
      )
      .catch(() => {
        // Non-fatal if studio update fails
      });
  }

  return connection;
}

/**
 * Disconnects an Instagram connection for a studio.
 */
export async function disconnectInstagramAccount(
  context: ContextWithStudio,
  connectionId: string,
  txExecutor: typeof db | Transaction = db
) {
  const [updated] = await txExecutor
    .update(instagramConnections)
    .set({
      status: "disconnected",
      encryptedAccessToken: "",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(instagramConnections.id, connectionId),
        eq(instagramConnections.studioId, context.studioId)
      )
    )
    .returning();

  return updated;
}

/**
 * Retrieves all Instagram connections for a studio (with masked / excluded tokens).
 */
export async function getInstagramConnections(studioId: string) {
  const connections = await db
    .select({
      id: instagramConnections.id,
      studioId: instagramConnections.studioId,
      userId: instagramConnections.userId,
      instagramAccountId: instagramConnections.instagramAccountId,
      instagramUsername: instagramConnections.instagramUsername,
      instagramName: instagramConnections.instagramName,
      pageId: instagramConnections.pageId,
      pageName: instagramConnections.pageName,
      status: instagramConnections.status,
      tokenExpiresAt: instagramConnections.tokenExpiresAt,
      lastError: instagramConnections.lastError,
      createdAt: instagramConnections.createdAt,
      updatedAt: instagramConnections.updatedAt,
    })
    .from(instagramConnections)
    .where(eq(instagramConnections.studioId, studioId))
    .orderBy(instagramConnections.createdAt);

  return connections;
}

/**
 * Fetches the active decrypted access token for a studio.
 */
export async function getActiveInstagramTokenForStudio(
  studioId: string
): Promise<{ accessToken: string; instagramAccountId: string } | null> {
  const [conn] = await db
    .select()
    .from(instagramConnections)
    .where(
      and(
        eq(instagramConnections.studioId, studioId),
        eq(instagramConnections.status, "connected")
      )
    )
    .limit(1);

  if (!conn || !conn.encryptedAccessToken) {
    return null;
  }

  try {
    const accessToken = decryptSecret(conn.encryptedAccessToken);
    return {
      accessToken,
      instagramAccountId: conn.instagramAccountId,
    };
  } catch {
    console.error("[Instagram Service] Failed to decrypt access token for studio:", studioId);
    return null;
  }
}
