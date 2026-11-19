import { describe, expect, it, vi } from "vitest";
import {
  generateInstagramAuthState,
  verifyInstagramAuthState,
  generateMetaAuthUrl,
  exchangeMetaAuthCode,
  fetchInstagramAccountDetails,
} from "@/features/instagram/server/oauth";

describe("Instagram / Meta OAuth Flow & Security", () => {
  const secretKey = "test-meta-oauth-signing-secret-key-32b!";
  const samplePayload = {
    studioId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "user-meta-123",
  };

  describe("1. State Parameter Cryptography & CSRF Protection", () => {
    it("generates and verifies valid OAuth state token with HMAC signature", () => {
      const state = generateInstagramAuthState(samplePayload, secretKey);
      expect(state).toContain(".");

      const verified = verifyInstagramAuthState(state, secretKey);
      expect(verified.studioId).toBe(samplePayload.studioId);
      expect(verified.userId).toBe(samplePayload.userId);
      expect(verified.timestamp).toBeGreaterThan(0);
      expect(verified.nonce).toBeDefined();
    });

    it("fails verification if state signature is tampered with", () => {
      const state = generateInstagramAuthState(samplePayload, secretKey);
      const [payload, sig] = state.split(".");
      const tampered = `${payload}.${sig}tampered`;

      expect(() => verifyInstagramAuthState(tampered, secretKey)).toThrow(
        "OAuth state signature verification failed"
      );
    });

    it("fails verification if payload is tampered with", () => {
      const state = generateInstagramAuthState(samplePayload, secretKey);
      const [payload, sig] = state.split(".");
      const tampered = `a${payload}.${sig}`;

      expect(() => verifyInstagramAuthState(tampered, secretKey)).toThrow();
    });

    it("fails verification if wrong secret key is used", () => {
      const state = generateInstagramAuthState(samplePayload, secretKey);
      expect(() => verifyInstagramAuthState(state, "wrong-secret-key")).toThrow(
        "OAuth state signature verification failed"
      );
    });

    it("fails verification if state is malformed", () => {
      expect(() => verifyInstagramAuthState("invalid-state", secretKey)).toThrow(
        "Invalid OAuth state format"
      );
    });
  });

  describe("2. Meta Authorization URL Generation", () => {
    it("constructs full Meta OAuth URL with required permissions and state", () => {
      const url = generateMetaAuthUrl({
        studioId: samplePayload.studioId,
        userId: samplePayload.userId,
        redirectUri: "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
        clientId: "meta-app-id-98765",
        stateSecret: secretKey,
      });

      expect(url.startsWith("https://www.facebook.com/")).toBe(true);
      expect(url).toContain("/dialog/oauth?");

      const parsed = new URL(url);
      expect(parsed.searchParams.get("client_id")).toBe("meta-app-id-98765");
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "https://pmu-crm.vercel.app/api/integrations/instagram/callback"
      );
      expect(parsed.searchParams.get("response_type")).toBe("code");
      expect(parsed.searchParams.get("auth_type")).toBe("rerequest");

      const scope = parsed.searchParams.get("scope");
      expect(scope).toContain("instagram_basic");
      expect(scope).toContain("instagram_manage_messages");
      expect(scope).toContain("pages_show_list");

      const stateParam = parsed.searchParams.get("state");
      expect(stateParam).toBeDefined();
      const verified = verifyInstagramAuthState(stateParam!, secretKey);
      expect(verified.studioId).toBe(samplePayload.studioId);
      expect(verified.userId).toBe(samplePayload.userId);
    });

    it("includes config_id when specified", () => {
      const url = generateMetaAuthUrl({
        studioId: samplePayload.studioId,
        userId: samplePayload.userId,
        redirectUri: "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
        clientId: "meta-app-id-98765",
        configId: "meta_config_12345",
        stateSecret: secretKey,
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get("config_id")).toBe("meta_config_12345");
    });
  });

  describe("3. Code Exchange & Token Discovery", () => {
    it("exchanges authorization code for long-lived access token", async () => {
      const mockFetch = vi
        .fn()
        // 1st call: short-lived token
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "short_lived_token_123",
            token_type: "bearer",
            expires_in: 3600,
          }),
        })
        // 2nd call: long-lived token exchange
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: "long_lived_token_456",
            token_type: "bearer",
            expires_in: 5184000,
          }),
        });

      const result = await exchangeMetaAuthCode(
        "auth_code_meta_999",
        "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
        { clientId: "app_id_1", clientSecret: "app_secret_1" },
        mockFetch as unknown as typeof fetch
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.accessToken).toBe("long_lived_token_456");
      expect(result.expiresIn).toBe(5184000);
    });

    it("handles failure during code exchange cleanly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Invalid verification code format.",
              type: "OAuthException",
              code: 100,
            },
          }),
      });

      await expect(
        exchangeMetaAuthCode(
          "invalid_code",
          "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
          { clientId: "app_id_1", clientSecret: "app_secret_1" },
          mockFetch as unknown as typeof fetch
        )
      ).rejects.toThrow("Invalid verification code format.");
    });

    it("discovers connected Instagram business accounts and page access tokens", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "page_123456",
              name: "PMU Alty Studio",
              access_token: "page_access_token_abc",
              instagram_business_account: {
                id: "17841400000000099",
                username: "pmu.alty",
                name: "PMU Alty Professional",
              },
            },
          ],
        }),
      });

      const discovered = await fetchInstagramAccountDetails(
        "user_access_token_123",
        mockFetch as unknown as typeof fetch
      );

      expect(discovered).toHaveLength(1);
      expect(discovered[0].instagramAccountId).toBe("17841400000000099");
      expect(discovered[0].instagramUsername).toBe("pmu.alty");
      expect(discovered[0].instagramName).toBe("PMU Alty Professional");
      expect(discovered[0].pageId).toBe("page_123456");
      expect(discovered[0].accessToken).toBe("page_access_token_abc");
    });
  });
});
