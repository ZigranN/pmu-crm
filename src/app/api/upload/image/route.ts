import { NextRequest, NextResponse } from "next/server";
import {
  requireBrowserStudioPermission,
  AuthRequiredError,
  StudioContextRequiredError,
  StudioContextStaleError,
  StudioAccessDeniedError,
  ForbiddenPermissionError,
} from "@/server/auth/context";
import { uploadToCloudinary } from "@/lib/cloudinary";
import {
  validateFile,
  FILE_SIZE_LIMITS,
  ALLOWED_FORMATS,
  FileValidationError,
} from "@/lib/file-validation";
import type { PermissionCode } from "@/lib/permissions";

export const UPLOAD_PURPOSES = {
  master_photo: {
    permission: "MASTER_UPDATE" as PermissionCode,
    folder: (studioId: string) => `crm-pmu/${studioId}/masters`,
  },
  studio_logo: {
    permission: "SETTINGS_UPDATE" as PermissionCode,
    folder: (studioId: string) => `crm-pmu/${studioId}/studio`,
  },
  profile_image: {
    permission: "SETTINGS_UPDATE" as PermissionCode,
    folder: (studioId: string) => `crm-pmu/${studioId}/profiles`,
  },
} as const;

export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const purpose = formData.get("purpose") as string | null;

    if (!purpose || !(purpose in UPLOAD_PURPOSES)) {
      return NextResponse.json(
        { error: "Invalid or missing upload purpose. Allowed: master_photo, studio_logo, profile_image" },
        { status: 400 }
      );
    }

    const purposeConfig = UPLOAD_PURPOSES[purpose as UploadPurpose];

    // Authenticate, resolve Active Studio context, and require capability permission
    const context = await requireBrowserStudioPermission(purposeConfig.permission);

    if (!file) {
      return NextResponse.json(
        { error: "File is required" },
        { status: 400 }
      );
    }

    // Authoritative magic-byte and size validation (Max 5MB, JPEG/PNG/WebP only, SVG blocked)
    await validateFile(file, {
      maxBytes: FILE_SIZE_LIMITS.GENERIC_MAX_BYTES,
      allowedTypes: ALLOWED_FORMATS.GENERIC_IMAGE,
    });

    // Upload to Cloudinary under purpose-bounded studio-namespaced folder with explicit resource_type: "image" and type: "upload"
    const { url, publicId } = await uploadToCloudinary(file, {
      folder: purposeConfig.folder(context.studioId),
      resource_type: "image",
      type: "upload",
    });

    return NextResponse.json({ url, publicId });
  } catch (error: any) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    if (
      error instanceof StudioContextRequiredError ||
      error instanceof StudioContextStaleError ||
      error instanceof StudioAccessDeniedError
    ) {
      return NextResponse.json(
        { error: error.message || "Studio context required" },
        { status: 403 }
      );
    }
    if (error instanceof ForbiddenPermissionError) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }
    if (error instanceof FileValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.error("Image upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
