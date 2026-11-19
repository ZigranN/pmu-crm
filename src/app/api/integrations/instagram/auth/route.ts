import { NextRequest, NextResponse } from "next/server";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import {
  generateMetaAuthUrl,
  InstagramOAuthConfigurationError,
} from "@/features/instagram/server/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;
  const settingsUrl = new URL("/settings/integrations/instagram", baseUrl);

  try {
    const context = await requireBrowserStudioPermission("INTEGRATION_MANAGE");
    const redirectUri = `${baseUrl}/api/integrations/instagram/callback`;

    const authUrl = await generateMetaAuthUrl({
      studioId: context.studioId,
      userId: context.userId,
      redirectUri,
    });

    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    if (err instanceof InstagramOAuthConfigurationError) {
      console.error("[Instagram OAuth Auth Route] Configuration error");
      settingsUrl.searchParams.set("error", "config_error");
      return NextResponse.redirect(settingsUrl);
    }
    console.error("[Instagram OAuth Auth Route] Authentication/permission error");
    settingsUrl.searchParams.set("error", "auth_required");
    return NextResponse.redirect(settingsUrl);
  }
}
