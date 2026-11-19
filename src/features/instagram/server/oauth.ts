import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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

const statePayloadSchema = z.object({
  studioId: z.string().uuid(),
  userId: z.string().min(1),
  timestamp: z.number().int(),
  nonce: z.string().min(1),
});

export type InstagramAuthStatePayload = z.infer<typeof statePayloadSchema>;

function resolveSecret(customSecret?: string): string {
  return (
    customSecret ||
    process.env.INSTAGRAM_STATE_SECRET ||
    process.env.META_APP_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "pmu-crm-instagram-oauth-state-signing-secret-key"
  );
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
  payload: Omit<InstagramAuthStatePayload, "timestamp" | "nonce">,
  secretKey?: string
): string {
  const secret = resolveSecret(secretKey);
  const data: InstagramAuthStatePayload = {
    ...payload,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString("hex"),
  };

  const encodedPayload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies and decodes the OAuth state parameter.
 * Rejects expired tokens (> 15 minutes) or tampered signatures.
 */
export function verifyInstagramAuthState(state: string, secretKey?: string): InstagramAuthStatePayload {
  const secret = resolveSecret(secretKey);
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid OAuth state format");
  }

  const [encodedPayload, providedSignature] = parts;
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new Error("OAuth state signature verification failed");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state JSON payload");
  }

  const validated = statePayloadSchema.parse(parsedJson);

  // Expiration check (15 minutes max lifetime, with 1 min clock skew allowance)
  const ageMs = Date.now() - validated.timestamp;
  if (ageMs > 15 * 60 * 1000 || ageMs < -60 * 1000) {
    throw new Error("OAuth state has expired");
  }

  return validated;
}

/**
 * Generates the full Meta / Instagram OAuth authorization URL.
 */
export function generateMetaAuthUrl(options: {
  studioId: string;
  userId: string;
  redirectUri: string;
  clientId?: string;
  scopes?: string[];
  stateSecret?: string;
  configId?: string;
}): string {
  const { clientId } = getMetaOAuthCredentials({ clientId: options.clientId });
  const scopes = (options.scopes || META_INSTAGRAM_DEFAULT_SCOPES).join(",");
  const state = generateInstagramAuthState(
    {
      studioId: options.studioId,
      userId: options.userId,
    },
    options.stateSecret
  );

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
    throw new Error("Meta App ID and Secret must be configured");
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
    const errorBody = await response.text();
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
  instagramUsername?: string;
  instagramName?: string;
  pageId?: string;
  pageName?: string;
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

  const discovered: DiscoveredInstagramAccount[] = [];

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const pages = Array.isArray(data.data) ? data.data : [];

    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        discovered.push({
          instagramAccountId: page.instagram_business_account.id,
          instagramUsername: page.instagram_business_account.username || null,
          instagramName: page.instagram_business_account.name || null,
          pageId: page.id,
          pageName: page.name || null,
          accessToken: page.access_token || userAccessToken,
        });
      }
    }
  }

  // Fallback: If no page with instagram_business_account found, query /me directly
  if (discovered.length === 0) {
    const meUrl = new URL(`${META_GRAPH_BASE}/me`);
    meUrl.searchParams.set("fields", "id,name");
    meUrl.searchParams.set("access_token", userAccessToken);

    const meRes = await fetchFn(meUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (meRes.ok) {
      const meData = await meRes.json().catch(() => ({}));
      if (meData.id) {
        discovered.push({
          instagramAccountId: meData.id,
          instagramUsername: meData.name || null,
          instagramName: meData.name || null,
          accessToken: userAccessToken,
        });
      }
    }
  }

  return discovered;
}
