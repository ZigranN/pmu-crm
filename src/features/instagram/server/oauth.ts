import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { verification } from "@/db/schema";
import type { Transaction } from "@/server/commands/ownership";

const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
const META_AUTH_ENDPOINT = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export const META_INSTAGRAM_DEFAULT_SCOPES = [
  "instagram_basic",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "business_management",
];

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const statePayloadSchema = z.object({
  studioId: z.string().uuid(),
  userId: z.string().min(1),
  timestamp: z.number().int(),
  nonce: z.string().min(1),
});

export type InstagramAuthStatePayload = z.infer<typeof statePayloadSchema>;

export class InstagramOAuthConfigurationError extends Error {
  public readonly code = "OAUTH_CONFIGURATION_ERROR";
  constructor(message = "Instagram OAuth state secret is not configured") {
    super(message);
    this.name = "InstagramOAuthConfigurationError";
  }
}

export class InstagramOAuthStateError extends Error {
  public readonly code: string;
  constructor(message: string, code: string = "invalid_state") {
    super(message);
    this.name = "InstagramOAuthStateError";
    this.code = code;
  }
}

export function resolveSecret(customSecret?: string): string {
  const secret =
    customSecret ||
    process.env.INSTAGRAM_STATE_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.trim().length === 0) {
    throw new InstagramOAuthConfigurationError(
      "Instagram OAuth state secret is not configured. Please set INSTAGRAM_STATE_SECRET, META_APP_SECRET, or BETTER_AUTH_SECRET in server environment."
    );
  }
  return secret.trim();
}

export function getMetaOAuthCredentials(custom?: { clientId?: string; clientSecret?: string }) {
  let clientId =
    custom?.clientId ||
    process.env.META_APP_ID ||
    process.env.INSTAGRAM_APP_ID ||
    process.env.META_CLIENT_ID ||
    "";
  let clientSecret =
    custom?.clientSecret ||
    process.env.META_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.META_CLIENT_SECRET ||
    "";

  clientId = clientId.trim();
  clientSecret = clientSecret.trim();

  return { clientId, clientSecret };
}

/**
 * Creates a cryptographically signed, tamper-proof state parameter for OAuth CSRF protection.
 */
export function generateInstagramAuthState(
  payload: Omit<InstagramAuthStatePayload, "timestamp" | "nonce"> & { nonce?: string },
  secretKey?: string
): string {
  const secret = resolveSecret(secretKey);
  const data: InstagramAuthStatePayload = {
    studioId: payload.studioId,
    userId: payload.userId,
    timestamp: Date.now(),
    nonce: payload.nonce || randomBytes(16).toString("hex"),
  };

  const encodedPayload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Stores the OAuth state nonce with TTL in the database for single-use verification.
 */
export async function storeInstagramOAuthNonce(
  nonce: string,
  studioId: string,
  userId: string,
  executor: typeof db | Transaction = db
): Promise<void> {
  const key = `instagram_oauth:${nonce}`;
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
  await executor
    .insert(verification)
    .values({
      id: key,
      identifier: `instagram_oauth:${studioId}:${userId}`,
      value: nonce,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Atomically consumes an OAuth state nonce.
 * Returns true if the nonce was valid, unexpired, and successfully claimed; false if replayed or expired.
 */
export async function consumeInstagramOAuthNonce(
  nonce: string,
  studioId: string,
  userId: string,
  executor: typeof db | Transaction = db
): Promise<boolean> {
  const key = `instagram_oauth:${nonce}`;
  const now = new Date();
  const deleted = await executor
    .delete(verification)
    .where(
      and(
        eq(verification.id, key),
        eq(verification.identifier, `instagram_oauth:${studioId}:${userId}`),
        gt(verification.expiresAt, now)
      )
    )
    .returning();

  return deleted.length > 0;
}

/**
 * Verifies and decodes the OAuth state parameter cryptographically.
 * Rejects expired tokens (> 15 minutes), malformed payloads, or tampered signatures.
 */
export function verifyInstagramAuthState(state: string, secretKey?: string): InstagramAuthStatePayload {
  const secret = resolveSecret(secretKey);
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new InstagramOAuthStateError("Invalid OAuth state format", "invalid_state");
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new InstagramOAuthStateError("OAuth state signature verification failed", "invalid_state");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new InstagramOAuthStateError("Invalid OAuth state JSON payload", "invalid_state");
  }

  const parseResult = statePayloadSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    throw new InstagramOAuthStateError("Invalid OAuth state schema", "invalid_state");
  }

  const validated = parseResult.data;

  // Expiration check (15 minutes max lifetime, with 1 min clock skew allowance)
  const ageMs = Date.now() - validated.timestamp;
  if (ageMs > OAUTH_STATE_TTL_MS || ageMs < -60 * 1000) {
    throw new InstagramOAuthStateError("OAuth state has expired", "state_expired");
  }

  return validated;
}

/**
 * Verifies the OAuth state signature, checks timestamp expiration, validates user/studio matching,
 * and atomically claims the single-use nonce in PostgreSQL.
 */
export async function verifyAndConsumeInstagramAuthState(
  state: string,
  options?: {
    secretKey?: string;
    executor?: typeof db | Transaction;
    expectedStudioId?: string;
    expectedUserId?: string;
  }
): Promise<InstagramAuthStatePayload> {
  const payload = verifyInstagramAuthState(state, options?.secretKey);

  if (options?.expectedStudioId && payload.studioId !== options.expectedStudioId) {
    throw new InstagramOAuthStateError("OAuth state studio mismatch", "studio_mismatch");
  }
  if (options?.expectedUserId && payload.userId !== options.expectedUserId) {
    throw new InstagramOAuthStateError("OAuth state user mismatch", "user_mismatch");
  }

  const consumed = await consumeInstagramOAuthNonce(
    payload.nonce,
    payload.studioId,
    payload.userId,
    options?.executor ?? db
  );

  if (!consumed) {
    throw new InstagramOAuthStateError(
      "OAuth state has already been used or is expired",
      "state_replay"
    );
  }

  return payload;
}

/**
 * Generates the full Meta / Instagram OAuth authorization URL.
 */
export async function generateMetaAuthUrl(options: {
  studioId: string;
  userId: string;
  redirectUri: string;
  clientId?: string;
  scopes?: string[];
  stateSecret?: string;
  configId?: string;
  executor?: typeof db | Transaction;
  skipPersistNonce?: boolean;
}): Promise<string> {
  const { clientId } = getMetaOAuthCredentials({ clientId: options.clientId });
  if (!clientId) {
    throw new InstagramOAuthConfigurationError("Meta App ID / Client ID is not configured");
  }

  const scopes = (options.scopes || META_INSTAGRAM_DEFAULT_SCOPES).join(",");
  const state = generateInstagramAuthState(
    {
      studioId: options.studioId,
      userId: options.userId,
    },
    options.stateSecret
  );

  if (!options.skipPersistNonce) {
    const verified = verifyInstagramAuthState(state, options.stateSecret);
    await storeInstagramOAuthNonce(
      verified.nonce,
      verified.studioId,
      verified.userId,
      options.executor
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: scopes,
    auth_type: "rerequest",
    state,
  });

  const configId = options.configId || process.env.META_CONFIG_ID;
  if (configId) {
    params.set("config_id", configId);
  }

  return `${META_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface MetaTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}

/**
 * Exchanges authorization code for a Meta user access token, then upgrades it to a long-lived token.
 */
export async function exchangeMetaAuthCode(
  code: string,
  redirectUri: string,
  customCredentials?: { clientId?: string; clientSecret?: string },
  fetchFn: typeof fetch = fetch
): Promise<MetaTokenResponse> {
  const { clientId, clientSecret } = getMetaOAuthCredentials(customCredentials);

  if (!clientId || !clientSecret) {
    throw new InstagramOAuthConfigurationError("Meta App ID and Secret must be configured");
  }

  // 1. Exchange authorization code for short-lived access token
  const tokenUrl = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const response = await fetchFn(tokenUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    let parsedMessage = `Status ${response.status}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.message) {
        parsedMessage = parsed.error.message;
      }
    } catch {
      // Use fallback status
    }
    throw new Error(`Failed to exchange Meta authorization code: ${parsedMessage}`);
  }

  const tokenData = await response.json();
  const shortLivedToken: string = tokenData.access_token;
  if (!shortLivedToken) {
    throw new Error("No access token returned from Meta authorization code exchange");
  }

  let finalToken = shortLivedToken;
  let finalExpiresIn: number | undefined = tokenData.expires_in;

  // 2. Exchange short-lived token for long-lived token (60 days)
  try {
    const longLivedUrl = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", clientId);
    longLivedUrl.searchParams.set("client_secret", clientSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

    const longLivedRes = await fetchFn(longLivedUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (longLivedRes.ok) {
      const longLivedData = await longLivedRes.json();
      if (longLivedData.access_token) {
        finalToken = longLivedData.access_token;
        finalExpiresIn = longLivedData.expires_in;
      }
    }
  } catch {
    // Non-fatal: if exchange fails, proceed with short-lived token
  }

  return {
    accessToken: finalToken,
    tokenType: tokenData.token_type || "bearer",
    expiresIn: finalExpiresIn,
  };
}

export interface DiscoveredInstagramAccount {
  instagramAccountId: string;
  instagramUsername?: string | null;
  instagramName?: string | null;
  pageId?: string;
  pageName?: string | null;
  accessToken: string; // Page access token (preferred for Instagram Graph API)
}

/**
 * Discovers connected Instagram Business accounts and associated Facebook Pages for the authenticated user.
 */
export async function fetchInstagramAccountDetails(
  userAccessToken: string,
  fetchFn: typeof fetch = fetch
): Promise<DiscoveredInstagramAccount[]> {
  const accountsUrl = new URL(`${META_GRAPH_BASE}/me/accounts`);
  accountsUrl.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}"
  );
  accountsUrl.searchParams.set("access_token", userAccessToken);

  const res = await fetchFn(accountsUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Meta Graph API returned status ${res.status} when querying /me/accounts`);
  }

  const discovered: DiscoveredInstagramAccount[] = [];
  const data = await res.json().catch(() => ({}));
  const pages = Array.isArray(data.data) ? data.data : [];

  for (const page of pages) {
    if (page?.instagram_business_account?.id) {
      const igId = String(page.instagram_business_account.id).trim();
      if (igId.length > 0) {
        discovered.push({
          instagramAccountId: igId,
          instagramUsername: page.instagram_business_account.username || null,
          instagramName: page.instagram_business_account.name || null,
          pageId: page.id ? String(page.id) : undefined,
          pageName: page.name || null,
          accessToken: page.access_token || userAccessToken,
        });
      }
    }
  }

  // Strictly DO NOT fall back to /me Facebook User ID!
  return discovered;
}
