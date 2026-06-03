import { NextRequest, NextResponse } from "next/server";
import { uploadMediaAction } from "@/features/media/server/actions";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const result = await uploadMediaAction(formData);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Media upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
