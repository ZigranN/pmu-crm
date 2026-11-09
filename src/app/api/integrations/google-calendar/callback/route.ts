import { NextRequest, NextResponse } from "next/server";
import {
  verifyGoogleAuthState,
  exchangeGoogleAuthCode,
  fetchGoogleUserProfile,
} from "@/features/google-calendar/server/oauth";
import { connectGoogleCalendar } from "@/features/google-calendar/server/service";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const baseUrl = request.nextUrl.origin;
  const settingsUrl = new URL("/settings/integrations/google-calendar", baseUrl);

  if (error) {
    settingsUrl.searchParams.set("error", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("error", "missing_code_or_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const authState = verifyGoogleAuthState(state);
    const redirectUri = `${baseUrl}/api/integrations/google-calendar/callback`;

    const tokens = await exchangeGoogleAuthCode(code, redirectUri);
    let userProfile: { googleAccountId?: string; email?: string; name?: string } = {};

    try {
      userProfile = await fetchGoogleUserProfile(tokens.accessToken);
    } catch {
      // Non-fatal if userinfo fails, proceed with connection
    }

    await connectGoogleCalendar(
      { studioId: authState.studioId, userId: authState.userId },
      {
        userId: authState.userId,
        masterId: authState.masterId,
        googleAccountId: userProfile.googleAccountId || null,
        googleEmail: userProfile.email || null,
        calendarId: "primary",
        calendarSummary: userProfile.name ? `${userProfile.name}'s Calendar` : "Primary Calendar",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
      }
    );

    settingsUrl.searchParams.set("connected", "true");
    return NextResponse.redirect(settingsUrl);
  } catch (err: any) {
    console.error("[Google OAuth Callback Error]", err);
    settingsUrl.searchParams.set("error", encodeURIComponent(err.message || "oauth_failed"));
    return NextResponse.redirect(settingsUrl);
  }
}
