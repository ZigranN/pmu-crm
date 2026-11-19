import { NextRequest, NextResponse } from "next/server";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { generateMetaAuthUrl } from "@/features/instagram/server/oauth";

export async function GET(request: NextRequest) {
  try {
    const context = await requireBrowserStudioContext();
    const baseUrl = request.nextUrl.origin;
    const redirectUri = `${baseUrl}/api/integrations/instagram/callback`;

    const authUrl = generateMetaAuthUrl({
      studioId: context.studioId,
      userId: context.userId,
      redirectUri,
    });

    return NextResponse.redirect(authUrl);
  } catch {
    const baseUrl = request.nextUrl.origin;
    const errorUrl = new URL("/settings/integrations/instagram", baseUrl);
    errorUrl.searchParams.set("error", "auth_required");
    return NextResponse.redirect(errorUrl);
  }
}
