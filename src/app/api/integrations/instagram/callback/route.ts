import { NextRequest, NextResponse } from "next/server";
import {
  verifyInstagramAuthState,
  exchangeMetaAuthCode,
  fetchInstagramAccountDetails,
} from "@/features/instagram/server/oauth";
import { connectInstagramAccount } from "@/features/instagram/server/service";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");
  const errorDescription = searchParams.get("error_description");

  const baseUrl = request.nextUrl.origin;
  const settingsUrl = new URL("/settings/integrations/instagram", baseUrl);

  if (error || errorReason) {
    const errorMsg = errorDescription || errorReason || error || "access_denied";
    settingsUrl.searchParams.set("error", encodeURIComponent(errorMsg));
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("error", "missing_code_or_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const authState = verifyInstagramAuthState(state);
    const redirectUri = `${baseUrl}/api/integrations/instagram/callback`;

    const tokens = await exchangeMetaAuthCode(code, redirectUri);
    const discovered = await fetchInstagramAccountDetails(tokens.accessToken);

    if (discovered.length > 0) {
      for (const account of discovered) {
        await connectInstagramAccount(
          { studioId: authState.studioId, userId: authState.userId },
          {
            instagramAccountId: account.instagramAccountId,
            instagramUsername: account.instagramUsername,
            instagramName: account.instagramName,
            pageId: account.pageId,
            pageName: account.pageName,
            accessToken: account.accessToken,
            expiresIn: tokens.expiresIn,
          }
        );
      }
    } else {
      // Connect using root user token if no sub-accounts found
      await connectInstagramAccount(
        { studioId: authState.studioId, userId: authState.userId },
        {
          instagramAccountId: authState.userId,
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        }
      );
    }

    settingsUrl.searchParams.set("connected", "true");
    return NextResponse.redirect(settingsUrl);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "oauth_failed";
    console.error("[Instagram OAuth Callback Error]", errorMsg);
    settingsUrl.searchParams.set("error", encodeURIComponent(errorMsg));
    return NextResponse.redirect(settingsUrl);
  }
}
