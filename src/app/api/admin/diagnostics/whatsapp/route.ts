import { NextResponse } from "next/server";
import { readSession, getUserActiveStudios } from "@/server/auth/context";
import { normalizeRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { checkWhatsAppSubscribedApps } from "@/features/whatsapp/server/diagnostic";

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
 * Temporary admin-only diagnostic endpoint for WhatsApp webhook delivery & subscribed_apps verification.
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
    console.error("[WhatsApp Diagnostic Endpoint] Unexpected error:", err instanceof Error ? err.message : "Unknown error");
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
