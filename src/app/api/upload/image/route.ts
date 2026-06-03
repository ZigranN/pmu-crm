import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/features/auth/server/actions";
import { uploadToCloudinary } from "@/lib/cloudinary";

export async function POST(req: NextRequest) {
  try {
    // Check auth
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "File is required" },
        { status: 400 }
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum 5MB" },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only images are allowed" },
        { status: 400 }
      );
    }

    // Upload to Cloudinary
    const { url, publicId } = await uploadToCloudinary(file, {
      folder: "crm-pmu/general",
    });

    return NextResponse.json({ url, publicId });
  } catch (error: any) {
    console.error("Image upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
