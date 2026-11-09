import { NextRequest, NextResponse } from "next/server";
import {
  requireBrowserStudioContext,
  AuthRequiredError,
  StudioContextRequiredError,
  StudioContextStaleError,
  StudioAccessDeniedError,
  ForbiddenPermissionError,
} from "@/server/auth/context";
import { mediaService } from "@/features/media/server/service";
import { getSignedCloudinaryDeliveryUrl } from "@/lib/cloudinary";
import { z } from "zod";

const uuidSchema = z.string().uuid();

export interface ResolvedProviderDelivery {
  resourceType: "image" | "raw";
  deliveryType: "upload" | "authenticated";
}

export function resolveProviderDelivery(url: string): ResolvedProviderDelivery | null {
  if (url.includes("/image/authenticated/")) {
    return { resourceType: "image", deliveryType: "authenticated" };
  }
  if (url.includes("/raw/authenticated/")) {
    return { resourceType: "raw", deliveryType: "authenticated" };
  }
  if (url.includes("/image/upload/")) {
    return { resourceType: "image", deliveryType: "upload" };
  }
  if (url.includes("/raw/upload/")) {
    return { resourceType: "raw", deliveryType: "upload" };
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: mediaId } = await params;

  if (!uuidSchema.safeParse(mediaId).success) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  let context;
  try {
    context = await requireBrowserStudioContext();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      error instanceof StudioContextRequiredError ||
      error instanceof StudioContextStaleError ||
      error instanceof StudioAccessDeniedError
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof ForbiddenPermissionError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let record;
  try {
    record = await mediaService.getMediaById(mediaId, context.studioId, "read");
  } catch (error) {
    if (
      error instanceof ForbiddenPermissionError ||
      (error instanceof Error && error.message === "Permission denied")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  if (!record) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const resolved = resolveProviderDelivery(record.url);
  if (!resolved) {
    console.error("Unclassifiable media provider delivery URL:", record.url);
    return NextResponse.json(
      { error: "Provider delivery error" },
      { status: 500 }
    );
  }

  let fetchUrl: string;
  if (resolved.deliveryType === "authenticated") {
    if (!record.publicId) {
      console.error("Missing publicId for authenticated asset:", record.id);
      return NextResponse.json(
        { error: "Provider delivery error" },
        { status: 500 }
      );
    }
    fetchUrl = getSignedCloudinaryDeliveryUrl(record.publicId, {
      resource_type: resolved.resourceType,
    });
  } else {
    fetchUrl = record.url;
  }

  try {
    const upstreamRes = await fetch(fetchUrl);
    if (!upstreamRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch asset from provider" },
        { status: upstreamRes.status }
      );
    }

    const isDownload =
      req.nextUrl.searchParams.get("download") === "1" ||
      req.nextUrl.searchParams.get("download") === "true";

    const upstreamContentType = upstreamRes.headers.get("content-type");
    let contentType = upstreamContentType || "application/octet-stream";
    const isPdf =
      resolved.resourceType === "raw" ||
      (record.type === "consent" &&
        (upstreamContentType === "application/pdf" ||
          record.url.toLowerCase().endsWith(".pdf") ||
          record.url.includes("/raw/")));

    if (isPdf) {
      contentType = "application/pdf";
    } else if (!upstreamContentType || upstreamContentType === "application/octet-stream") {
      contentType = "image/jpeg";
    }

    const ext = isPdf ? "pdf" : "jpg";
    const filename = `${record.type}-${record.id}.${ext}`;
    const dispositionType = isDownload ? "attachment" : "inline";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `${dispositionType}; filename="${filename}"`);
    headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
    headers.set("X-Content-Type-Options", "nosniff");

    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstreamRes.body, {
      status: 200,
      headers,
    });
  } catch (fetchError) {
    console.error("Provider stream error:", fetchError);
    return NextResponse.json(
      { error: "Provider delivery error" },
      { status: 502 }
    );
  }
}
