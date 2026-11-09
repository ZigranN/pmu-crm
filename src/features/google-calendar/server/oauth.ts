import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_CALENDAR_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const statePayloadSchema = z.object({
  studioId: z.string().uuid(),
  userId: z.string().min(1),
  masterId: z.string().uuid().nullable().optional(),
  timestamp: z.number().int(),
  nonce: z.string().min(1),
});

export type GoogleAuthStatePayload = z.infer<typeof statePayloadSchema>;

function resolveSecret(customSecret?: string): string {
  return (
    customSecret ||
    process.env.GOOGLE_CALENDAR_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "pmu-crm-google-oauth-state-signing-secret-key"
  );
}

export function getGoogleOAuthCredentials(custom?: { clientId?: string; clientSecret?: string }) {
  let clientId =
    custom?.clientId ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.IDCLIENT_GOOGLE_CALENDARE ||
    "";
  let clientSecret =
    custom?.clientSecret ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.SECRET_CLIENT_ID_GOOGLE_CALENDARE ||
    "";

  clientId = clientId.trim();
  clientSecret = clientSecret.trim();
  // Automatically sanitize accidental Cyrillic homoglyphs (e.g. Cyrillic Р -> Latin P)
  clientSecret = clientSecret.replace(/\u0420/g, "P").replace(/\u0440/g, "p");

  return { clientId, clientSecret };
}

/**
 * Creates a signed, tamper-proof state parameter for OAuth CSRF protection.
 */
export function generateGoogleAuthState(
  payload: Omit<GoogleAuthStatePayload, "timestamp" | "nonce">,
  secretKey?: string
): string {
  const secret = resolveSecret(secretKey);
  const data: GoogleAuthStatePayload = {
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
export function verifyGoogleAuthState(state: string, secretKey?: string): GoogleAuthStatePayload {
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

  // Expiration check (15 minutes max lifetime)
  const ageMs = Date.now() - validated.timestamp;
  if (ageMs > 15 * 60 * 1000 || ageMs < -60 * 1000) {
    throw new Error("OAuth state has expired");
  }

  return validated;
}

/**
 * Generates the full Google OAuth authorization URL.
 */
export function generateGoogleAuthUrl(options: {
  studioId: string;
  userId: string;
  masterId?: string | null;
  redirectUri: string;
  clientId?: string;
  scopes?: string[];
  stateSecret?: string;
}): string {
  const { clientId } = getGoogleOAuthCredentials({ clientId: options.clientId });
  const scopes = (options.scopes || GOOGLE_CALENDAR_DEFAULT_SCOPES).join(" ");
  const state = generateGoogleAuthState(
    {
      studioId: options.studioId,
      userId: options.userId,
      masterId: options.masterId ?? null,
    },
    options.stateSecret
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
  tokenType: string;
  idToken?: string;
}

/**
 * Exchanges authorization code for Google access and refresh tokens.
 */
export async function exchangeGoogleAuthCode(
  code: string,
  redirectUri: string,
  customCredentials?: { clientId?: string; clientSecret?: string }
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials(customCredentials);

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to exchange Google OAuth code: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
    idToken: data.id_token,
  };
}

/**
 * Refreshes an expired access token using the stored refresh token.
 */
export async function refreshGoogleAccessToken(
  refreshToken: string,
  customCredentials?: { clientId?: string; clientSecret?: string }
): Promise<{ accessToken: string; expiresIn: number; scope?: string }> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials(customCredentials);

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to refresh Google access token: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/**
 * Fetches user profile information (email and account ID) from Google.
 */
export async function fetchGoogleUserProfile(
  accessToken: string
): Promise<{ googleAccountId: string; email: string; name?: string }> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Google user profile: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  return {
    googleAccountId: data.id,
    email: data.email,
    name: data.name,
  };
}
