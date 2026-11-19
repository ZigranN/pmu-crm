import { NextRequest, NextResponse } from "next/server";
import {
  verifyAndConsumeInstagramAuthState,
  exchangeMetaAuthCode,
  fetchInstagramAccountDetails,
  InstagramOAuthStateError,
  InstagramOAuthConfigurationError,
} from "@/features/instagram/server/oauth";
import { connectInstagramAccount } from "@/features/instagram/server/service";
import {
  requireAuthenticatedUser,
  requireStudioPermissionFor,
} from "@/server/auth/context";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");

  const baseUrl = request.nextUrl.origin;
  const settingsUrl = new URL("/settings/integrations/instagram", baseUrl);

  if (error || errorReason) {
    settingsUrl.searchParams.set("error", "access_denied");
    return NextResponse.redirect(settingsUrl);
  }

  if (!code || !state) {
    settingsUrl.searchParams.set("error", "missing_code_or_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    // 1. Verify authenticated user session
    let sessionUser;
    try {
      sessionUser = await requireAuthenticatedUser();
    } catch {
      settingsUrl.searchParams.set("error", "auth_required");
      return NextResponse.redirect(settingsUrl);
    }

    // 2. Cryptographically verify state and atomically claim single-use nonce
    let authState;
    try {
      authState = await verifyAndConsumeInstagramAuthState(state, {
        expectedUserId: sessionUser.id,
      });
    } catch (stateErr: unknown) {
      const code =
        stateErr instanceof InstagramOAuthStateError
          ? stateErr.code
          : "invalid_state";
      console.error("[Instagram OAuth Callback] State error code:", code);
      settingsUrl.searchParams.set("error", code);
      return NextResponse.redirect(settingsUrl);
    }

    // 3. Verify studio membership and INTEGRATION_MANAGE permission
    try {
      await requireStudioPermissionFor(
        sessionUser.id,
        authState.studioId,
        "INTEGRATION_MANAGE"
      );
    } catch {
      console.error("[Instagram OAuth Callback] Permission check failed");
      settingsUrl.searchParams.set("error", "forbidden");
      return NextResponse.redirect(settingsUrl);
    }

    // 4. Exchange authorization code for access token
    const redirectUri = `${baseUrl}/api/integrations/instagram/callback`;
    let tokens;
    try {
      tokens = await exchangeMetaAuthCode(code, redirectUri);
    } catch (exchangeErr: unknown) {
      if (exchangeErr instanceof InstagramOAuthConfigurationError) {
        console.error("[Instagram OAuth Callback] Configuration error");
        settingsUrl.searchParams.set("error", "config_error");
        return NextResponse.redirect(settingsUrl);
      }
      console.error("[Instagram OAuth Callback] Token exchange failed");
      settingsUrl.searchParams.set("error", "token_exchange_failed");
      return NextResponse.redirect(settingsUrl);
    }

    // 5. Discover Instagram Business account(s)
    let discovered;
    try {
      discovered = await fetchInstagramAccountDetails(tokens.accessToken);
    } catch {
      console.error("[Instagram OAuth Callback] Account discovery failed");
      settingsUrl.searchParams.set("error", "account_discovery_failed");
      return NextResponse.redirect(settingsUrl);
    }

    if (discovered.length === 0) {
      settingsUrl.searchParams.set("error", "no_instagram_business_account_found");
      return NextResponse.redirect(settingsUrl);
    }

    // 6. Connect verified Instagram Business accounts
    for (const account of discovered) {
      await connectInstagramAccount(
        { studioId: authState.studioId, userId: sessionUser.id },
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

    settingsUrl.searchParams.set("connected", "true");
    return NextResponse.redirect(settingsUrl);
  } catch {
    console.error("[Instagram OAuth Callback] Unhandled callback error");
    settingsUrl.searchParams.set("error", "oauth_failed");
    return NextResponse.redirect(settingsUrl);
  }
}
