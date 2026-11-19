import { NextResponse } from "next/server";
import { readSession, getUserActiveStudios } from "@/server/auth/context";
import { normalizeRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import {
  checkWhatsAppSubscribedApps,
  subscribeWhatsAppAppToWaba,
  sanitizeMetaErrorMessage,
  DEFAULT_WABA_ID,
  DEFAULT_TARGET_APP_ID,
} from "@/features/whatsapp/server/diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Validates Origin and Sec-Fetch-Site to protect against cross-site request forgery.
 */
function validateOriginAndCsrf(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite === "cross-site") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;
    const originHostname = originUrl.hostname;
    const hostHostname = host.split(":")[0];

    return originHost === host || originHostname === hostHostname;
  } catch {
    return false;
  }
}

/**
 * Checks if the user has OWNER or ADMIN role (either system-level or within active studios).
 * Generic integration permissions are not sufficient for subscription changes.
 */
async function isUserOwnerOrAdmin(userId: string, userRole?: string | null): Promise<boolean> {
  const normalizedUserRole = userRole ? normalizeRole(userRole) : null;
  if (normalizedUserRole === "OWNER" || normalizedUserRole === "ADMIN") {
    return true;
  }

  const activeStudios = await getUserActiveStudios(userId);
  for (const studio of activeStudios) {
    const role = normalizeRole(studio.role);
    if (role === "OWNER" || role === "ADMIN") {
      return true;
    }
  }

  return false;
}

/**
 * Temporary admin-only diagnostic endpoint for WhatsApp webhook delivery & subscribed_apps verification.
 * Read-only diagnostic check. Does NOT mutate any state.
 */
export async function GET() {
  try {
    const session = await readSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    // Authorization check: Verify if the user is a PMU CRM administrator
    const userRole = session.user.role ? normalizeRole(session.user.role) : null;
    let isAuthorizedAdmin = userRole === "OWNER" || userRole === "ADMIN";

    if (!isAuthorizedAdmin) {
      const activeStudios = await getUserActiveStudios(session.user.id);
      for (const studio of activeStudios) {
        if (studio.role === "OWNER" || studio.role === "ADMIN") {
          isAuthorizedAdmin = true;
          break;
        }

        const canManageIntegrations = await hasPermission(
          db,
          session.user.id,
          studio.studioId,
          "INTEGRATION_MANAGE"
        );
        if (canManageIntegrations) {
          isAuthorizedAdmin = true;
          break;
        }
      }
    }

    if (!isAuthorizedAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Administrator authorization required" },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    const result = await checkWhatsAppSubscribedApps();

    return NextResponse.json(result, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err: unknown) {
    console.error(
      "[WhatsApp Diagnostic Endpoint] Unexpected error:",
      err instanceof Error ? sanitizeMetaErrorMessage(err.message) : "Unknown error"
    );
    return NextResponse.json(
      {
        tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()),
        graphApiSuccess: false,
        appSubscribed: false,
        error: {
          message: "Internal diagnostic execution error",
        },
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}

/**
 * Secure, temporary, admin-only POST action to subscribe Meta App ID to WhatsApp Business Account (WABA).
 * Strictly requires authenticated OWNER or ADMIN role and explicit confirmation payload.
 */
export async function POST(request: Request) {
  try {
    // 1. Origin & CSRF validation
    if (!validateOriginAndCsrf(request)) {
      return NextResponse.json(
        { error: "Forbidden: Cross-site or invalid origin request rejected" },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    // 2. Authentication check
    const session = await readSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    // 3. Authorization check: strictly require authenticated OWNER or ADMIN access
    const isOwnerOrAdmin = await isUserOwnerOrAdmin(session.user.id, session.user.role);
    if (!isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: OWNER or ADMIN role required for subscription modification" },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    // 4. Confirmation requirement: Never execute automatically
    let body: Record<string, unknown> = {};
    try {
      const rawText = await request.text();
      if (rawText.trim().length > 0) {
        body = JSON.parse(rawText);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    if (body.confirm !== true) {
      return NextResponse.json(
        {
          error: "Explicit confirmation required: payload must include { confirm: true } to execute WABA app subscription",
        },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        }
      );
    }

    // 5. Execute subscription & post-subscription verification
    const result = await subscribeWhatsAppAppToWaba();

    return NextResponse.json(result, {
      status: result.graphApiSuccess ? 200 : 502,
      headers: NO_STORE_HEADERS,
    });
  } catch (err: unknown) {
    const safeErrorMsg = err instanceof Error ? sanitizeMetaErrorMessage(err.message) : "Unknown error";
    console.error("[WhatsApp Subscription Endpoint] Unexpected error:", safeErrorMsg);
    return NextResponse.json(
      {
        tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()),
        graphApiSuccess: false,
        subscribed: false,
        appSubscribed: false,
        verified: false,
        wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? DEFAULT_WABA_ID,
        targetAppId: process.env.META_APP_ID ?? DEFAULT_TARGET_APP_ID,
        error: {
          message: "Internal subscription execution error",
        },
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }
}
