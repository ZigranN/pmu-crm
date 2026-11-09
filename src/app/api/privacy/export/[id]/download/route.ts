import { NextRequest, NextResponse } from "next/server";
import {
  requireBrowserStudioPermission,
  AuthRequiredError,
  StudioContextRequiredError,
  StudioContextStaleError,
  StudioAccessDeniedError,
  ForbiddenPermissionError,
} from "@/server/auth/context";
import { db } from "@/db";
import { privacyRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { buildClientExportBundle } from "@/features/privacy/server/export-service";
import { sensitiveRead } from "@/server/services/access-log.service";
import { writeAudit } from "@/server/services/audit-log.service";
import { z } from "zod";
import type { ClientExportBundle } from "@/features/privacy/schemas/privacy.schema";

const uuidSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const studioContext = await requireBrowserStudioPermission("PRIVACY_EXPORT");
    const { id } = await context.params;

    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json({ error: "Invalid export request ID" }, { status: 400 });
    }

    const [privacyReq] = await db
      .select()
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.id, parsedId.data),
          eq(privacyRequests.studioId, studioContext.studioId)
        )
      )
      .limit(1);

    if (!privacyReq) {
      return NextResponse.json({ error: "Privacy export request not found" }, { status: 404 });
    }

    if (privacyReq.status !== "COMPLETED" || !privacyReq.exportArtifactId) {
      return NextResponse.json(
        { error: "Export is not ready", status: privacyReq.status },
        { status: 400 }
      );
    }

    if (privacyReq.exportExpiresAt && new Date() > privacyReq.exportExpiresAt) {
      return NextResponse.json(
        { error: "Export artifact has expired" },
        { status: 410 }
      );
    }

    const bundle = await sensitiveRead<ClientExportBundle>(
      "PRIVACY_EXPORT",
      studioContext.studioId,
      { operation: "privacy.export.download", targetId: privacyReq.id },
      async () => {
        return buildClientExportBundle(studioContext.studioId, privacyReq.clientId);
      },
      (res: ClientExportBundle) => [res.manifest.clientId]
    );

    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        studioId: studioContext.studioId,
        userId: studioContext.userId,
        action: "privacy_export_downloaded",
        entityType: "privacy_request",
        entityId: privacyReq.id,
        before: null,
        after: { downloadedAt: new Date().toISOString() },
        reason: "command:privacy_export_downloaded",
        metadata: { clientId: privacyReq.clientId },
      });
    });

    const jsonString = JSON.stringify(bundle, null, 2);
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `privacy-export-${privacyReq.clientId}-${dateStr}.json`;

    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(jsonString, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (err instanceof StudioContextRequiredError || err instanceof StudioContextStaleError) {
      return NextResponse.json({ error: "Active studio context required" }, { status: 400 });
    }
    if (err instanceof StudioAccessDeniedError || err instanceof ForbiddenPermissionError) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    console.error("Privacy export download error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
