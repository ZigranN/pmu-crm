import "server-only";

export const DEFAULT_WABA_ID = "107183208737515";
export const DEFAULT_TARGET_APP_ID = "1763936925735072";
export const GRAPH_API_VERSION = "v27.0";

export interface SanitizedMetaError {
  code?: number | string;
  subcode?: number | string;
  type?: string;
  message?: string;
}

export interface WhatsAppDiagnosticResult {
  tokenConfigured: boolean;
  graphApiSuccess: boolean;
  appSubscribed: boolean;
  error?: SanitizedMetaError | null;
}

export interface WhatsAppSubscribeResult {
  tokenConfigured: boolean;
  graphApiSuccess: boolean;
  subscribed: boolean;
  appSubscribed: boolean;
  verified: boolean;
  wabaId: string;
  targetAppId: string;
  error?: SanitizedMetaError | null;
}

export interface CheckWhatsAppSubscribedAppsOptions {
  wabaId?: string;
  targetAppId?: string;
  token?: string;
  fetchFn?: typeof fetch;
}

export interface SubscribeWhatsAppAppToWabaOptions {
  wabaId?: string;
  targetAppId?: string;
  token?: string;
  fetchFn?: typeof fetch;
}

export function sanitizeMetaErrorMessage(message?: unknown): string {
  if (!message || typeof message !== "string") {
    return "Unknown Meta API error";
  }

  return message
    .replace(/EA[A-Za-z0-9_-]{10,}/g, "[REDACTED_TOKEN]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED_TOKEN]")
    .trim();
}

export function isAppSubscribedInData(data: unknown, targetAppId: string): boolean {
  if (!Array.isArray(data)) {
    return false;
  }

  const normalizedTargetId = String(targetAppId).trim();

  return data.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const record = entry as Record<string, unknown>;

    // Direct id field
    if (record.id !== undefined && String(record.id).trim() === normalizedTargetId) {
      return true;
    }

    // WhatsApp Business API data wrapper
    if (
      record.whatsapp_business_api_data &&
      typeof record.whatsapp_business_api_data === "object"
    ) {
      const wabaData = record.whatsapp_business_api_data as Record<string, unknown>;
      if (wabaData.id !== undefined && String(wabaData.id).trim() === normalizedTargetId) {
        return true;
      }
    }

    // App wrapper
    if (record.app && typeof record.app === "object") {
      const appData = record.app as Record<string, unknown>;
      if (appData.id !== undefined && String(appData.id).trim() === normalizedTargetId) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Diagnostic check to verify whether Meta App ID is subscribed to WhatsApp Business Account (WABA).
 * Performs a read-only GET request against Meta Graph API.
 * Never logs or exposes tokens or secrets.
 */
export async function checkWhatsAppSubscribedApps(
  options: CheckWhatsAppSubscribedAppsOptions = {}
): Promise<WhatsAppDiagnosticResult> {
  const token = options.token ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = (options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? DEFAULT_WABA_ID).trim();
  const targetAppId = (options.targetAppId ?? process.env.META_APP_ID ?? DEFAULT_TARGET_APP_ID).trim();
  const fetchFn = options.fetchFn ?? fetch;

  const isConfigured = Boolean(token && token.trim().length > 0);

  if (!isConfigured) {
    return {
      tokenConfigured: false,
      graphApiSuccess: false,
      appSubscribed: false,
      error: {
        message: "WHATSAPP_ACCESS_TOKEN is not configured in environment",
      },
    };
  }

  const cleanToken = token!.trim();
  const endpointUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/subscribed_apps`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetchFn(endpointUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawBody = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }

    if (!response.ok) {
      const metaError = (json && typeof json.error === "object" ? json.error : null) as Record<string, unknown> | null;

      const code = metaError?.code !== undefined ? Number(metaError.code) : response.status;
      const subcode = metaError?.error_subcode !== undefined ? Number(metaError.error_subcode) : undefined;
      const type = typeof metaError?.type === "string" ? metaError.type : undefined;
      const rawMessage = typeof metaError?.message === "string" ? metaError.message : `Meta Graph API returned status ${response.status}`;

      return {
        tokenConfigured: true,
        graphApiSuccess: false,
        appSubscribed: false,
        error: {
          code,
          ...(subcode !== undefined ? { subcode } : {}),
          ...(type ? { type } : {}),
          message: sanitizeMetaErrorMessage(rawMessage),
        },
      };
    }

    const dataArray = json && Array.isArray(json.data) ? json.data : [];
    const subscribed = isAppSubscribedInData(dataArray, targetAppId);

    return {
      tokenConfigured: true,
      graphApiSuccess: true,
      appSubscribed: subscribed,
      error: null,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Network error contacting Meta Graph API";
    return {
      tokenConfigured: true,
      graphApiSuccess: false,
      appSubscribed: false,
      error: {
        message: sanitizeMetaErrorMessage(errorMessage),
      },
    };
  }
}

/**
 * Admin action to subscribe Meta App ID to WhatsApp Business Account (WABA).
 * Performs POST request to /subscribed_apps, then verifies subscription with GET /subscribed_apps.
 * Never logs or exposes tokens or secrets.
 */
export async function subscribeWhatsAppAppToWaba(
  options: SubscribeWhatsAppAppToWabaOptions = {}
): Promise<WhatsAppSubscribeResult> {
  const token = options.token ?? process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = (options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? DEFAULT_WABA_ID).trim();
  const targetAppId = (options.targetAppId ?? process.env.META_APP_ID ?? DEFAULT_TARGET_APP_ID).trim();
  const fetchFn = options.fetchFn ?? fetch;

  const isConfigured = Boolean(token && token.trim().length > 0);

  if (!isConfigured) {
    return {
      tokenConfigured: false,
      graphApiSuccess: false,
      subscribed: false,
      appSubscribed: false,
      verified: false,
      wabaId,
      targetAppId,
      error: {
        message: "WHATSAPP_ACCESS_TOKEN is not configured in environment",
      },
    };
  }

  const cleanToken = token!.trim();
  const endpointUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/subscribed_apps`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetchFn(endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawBody = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }

    if (!response.ok) {
      const metaError = (json && typeof json.error === "object" ? json.error : null) as Record<string, unknown> | null;

      const code = metaError?.code !== undefined ? Number(metaError.code) : response.status;
      const subcode = metaError?.error_subcode !== undefined ? Number(metaError.error_subcode) : undefined;
      const type = typeof metaError?.type === "string" ? metaError.type : undefined;
      const rawMessage = typeof metaError?.message === "string" ? metaError.message : `Meta Graph API returned status ${response.status}`;

      return {
        tokenConfigured: true,
        graphApiSuccess: false,
        subscribed: false,
        appSubscribed: false,
        verified: false,
        wabaId,
        targetAppId,
        error: {
          code,
          ...(subcode !== undefined ? { subcode } : {}),
          ...(type ? { type } : {}),
          message: sanitizeMetaErrorMessage(rawMessage),
        },
      };
    }

    const postSuccess = Boolean(json?.success ?? true);

    // After successful subscription POST, recheck GET /subscribed_apps to verify targetAppId is present
    const verificationCheck = await checkWhatsAppSubscribedApps({
      wabaId,
      targetAppId,
      token: cleanToken,
      fetchFn,
    });

    const isVerified = verificationCheck.appSubscribed;

    return {
      tokenConfigured: true,
      graphApiSuccess: true,
      subscribed: postSuccess,
      appSubscribed: verificationCheck.appSubscribed,
      verified: isVerified,
      wabaId,
      targetAppId,
      error: !isVerified
        ? verificationCheck.error ?? {
            message: "Subscription POST was accepted by Meta, but app ID was not found in GET /subscribed_apps verification check",
          }
        : null,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Network error contacting Meta Graph API";
    return {
      tokenConfigured: true,
      graphApiSuccess: false,
      subscribed: false,
      appSubscribed: false,
      verified: false,
      wabaId,
      targetAppId,
      error: {
        message: sanitizeMetaErrorMessage(errorMessage),
      },
    };
  }
}
