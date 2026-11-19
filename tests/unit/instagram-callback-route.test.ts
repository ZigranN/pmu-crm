import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/integrations/instagram/callback/route";
import * as authContext from "@/server/auth/context";
import * as instagramService from "@/features/instagram/server/service";
import * as oauthModule from "@/features/instagram/server/oauth";

vi.mock("@/server/auth/context", () => ({
  requireAuthenticatedUser: vi.fn(),
  requireStudioPermissionFor: vi.fn(),
}));

vi.mock("@/features/instagram/server/service", () => ({
  connectInstagramAccount: vi.fn(),
}));

describe("Instagram OAuth Callback Route (/api/integrations/instagram/callback)", () => {
  const baseUrl = "https://pmu-crm.vercel.app";
  const validStudioId = "123e4567-e89b-12d3-a456-426614174000";
  const validUserId = "user-meta-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects with access_denied when Meta returns an error or cancellation", async () => {
    const req = new NextRequest(
      `${baseUrl}/api/integrations/instagram/callback?error=access_denied&error_reason=user_denied&error_description=User+denied+auth`
    );

    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/settings/integrations/instagram");
    expect(location).toContain("error=access_denied");
    expect(location).not.toContain("User+denied+auth"); // does not leak raw description
  });

  it("redirects with missing_code_or_state when code or state is absent", async () => {
    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=missing_code_or_state");
  });

  it("redirects with auth_required when user is not authenticated", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockRejectedValueOnce(new Error("AUTH_REQUIRED"));

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=auth_required");
  });

  it("redirects with state error (e.g. state_replay) when state consumption fails", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockResolvedValueOnce({
      id: validUserId,
      email: "test@alty.com",
    } as any);

    vi.spyOn(oauthModule, "verifyAndConsumeInstagramAuthState").mockRejectedValueOnce(
      new oauthModule.InstagramOAuthStateError("OAuth state has already been used or is expired", "state_replay")
    );

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=state_replay");
  });

  it("redirects with forbidden when user lacks studio INTEGRATION_MANAGE permission", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockResolvedValueOnce({
      id: validUserId,
      email: "test@alty.com",
    } as any);

    vi.spyOn(oauthModule, "verifyAndConsumeInstagramAuthState").mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      timestamp: Date.now(),
      nonce: "test-nonce-123",
    });

    vi.mocked(authContext.requireStudioPermissionFor).mockRejectedValueOnce(
      new Error("FORBIDDEN_PERMISSION")
    );

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=forbidden");
  });

  it("redirects with token_exchange_failed when Meta code exchange fails without leaking raw errors", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockResolvedValueOnce({
      id: validUserId,
      email: "test@alty.com",
    } as any);

    vi.spyOn(oauthModule, "verifyAndConsumeInstagramAuthState").mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      timestamp: Date.now(),
      nonce: "test-nonce-123",
    });

    vi.mocked(authContext.requireStudioPermissionFor).mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      membershipId: "mem-1",
      role: "ADMIN",
      studioName: "Alty Studio",
    });

    vi.spyOn(oauthModule, "exchangeMetaAuthCode").mockRejectedValueOnce(
      new Error("Failed to exchange Meta authorization code: Raw internal token secret trace error")
    );

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("error=token_exchange_failed");
    expect(location).not.toContain("Raw internal token"); // Never leaks internal errors
  });

  it("redirects with no_instagram_business_account_found and DOES NOT connect account when no IG business account is discovered", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockResolvedValueOnce({
      id: validUserId,
      email: "test@alty.com",
    } as any);

    vi.spyOn(oauthModule, "verifyAndConsumeInstagramAuthState").mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      timestamp: Date.now(),
      nonce: "test-nonce-123",
    });

    vi.mocked(authContext.requireStudioPermissionFor).mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      membershipId: "mem-1",
      role: "ADMIN",
      studioName: "Alty Studio",
    });

    vi.spyOn(oauthModule, "exchangeMetaAuthCode").mockResolvedValueOnce({
      accessToken: "meta_long_lived_user_token_123",
      tokenType: "bearer",
      expiresIn: 5184000,
    });

    vi.spyOn(oauthModule, "fetchInstagramAccountDetails").mockResolvedValueOnce([]);

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=no_instagram_business_account_found");

    // Critical assertion: verify no connection was created with fallback
    expect(instagramService.connectInstagramAccount).not.toHaveBeenCalled();
  });

  it("successfully connects confirmed Instagram account and redirects with connected=true", async () => {
    vi.mocked(authContext.requireAuthenticatedUser).mockResolvedValueOnce({
      id: validUserId,
      email: "test@alty.com",
    } as any);

    vi.spyOn(oauthModule, "verifyAndConsumeInstagramAuthState").mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      timestamp: Date.now(),
      nonce: "test-nonce-123",
    });

    vi.mocked(authContext.requireStudioPermissionFor).mockResolvedValueOnce({
      studioId: validStudioId,
      userId: validUserId,
      membershipId: "mem-1",
      role: "ADMIN",
      studioName: "Alty Studio",
    });

    vi.spyOn(oauthModule, "exchangeMetaAuthCode").mockResolvedValueOnce({
      accessToken: "meta_long_lived_user_token_123",
      tokenType: "bearer",
      expiresIn: 5184000,
    });

    vi.spyOn(oauthModule, "fetchInstagramAccountDetails").mockResolvedValueOnce([
      {
        instagramAccountId: "17841400000000099",
        instagramUsername: "pmu.alty",
        instagramName: "PMU Alty",
        pageId: "page_12345",
        pageName: "Alty Studio Facebook",
        accessToken: "page_access_token_999",
      },
    ]);

    const req = new NextRequest(`${baseUrl}/api/integrations/instagram/callback?code=abc&state=xyz`);
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("connected=true");

    expect(instagramService.connectInstagramAccount).toHaveBeenCalledWith(
      { studioId: validStudioId, userId: validUserId },
      {
        instagramAccountId: "17841400000000099",
        instagramUsername: "pmu.alty",
        instagramName: "PMU Alty",
        pageId: "page_12345",
        pageName: "Alty Studio Facebook",
        accessToken: "page_access_token_999",
        expiresIn: 5184000,
      }
    );
  });
});
