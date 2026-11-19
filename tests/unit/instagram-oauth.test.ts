import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  generateInstagramAuthState,
  verifyInstagramAuthState,
  verifyAndConsumeInstagramAuthState,
  storeInstagramOAuthNonce,
  generateMetaAuthUrl,
  exchangeMetaAuthCode,
  fetchInstagramAccountDetails,
  resolveSecret,
  InstagramOAuthConfigurationError,
} from "@/features/instagram/server/oauth";

function createMockExecutor() {
  const store = new Map<string, { id: string; identifier: string; value: string; expiresAt: Date }>();
  return {
    store,
    insert: vi.fn(() => ({
      values: vi.fn((val: any) => {
        store.set(val.id, val);
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => {
          const now = new Date();
          // Find entry matching key & identifier & unexpired
          for (const [key, item] of store.entries()) {
            if (item.expiresAt > now) {
              store.delete(key);
              return [item];
            }
          }
          return [];
        }),
      })),
    })),
  };
}

describe("Instagram / Meta OAuth Flow & Security", () => {
  const secretKey = "test-meta-oauth-signing-secret-key-32b!";
  const samplePayload = {
    studioId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "user-meta-123",
  };

  describe("1. State Parameter Cryptography, Secrets & Nonce Security", () => {
    it("generates and verifies valid OAuth state token with HMAC signature", () => {
      const state = generateInstagramAuthState(samplePayload, secretKey);
      expect(state).toContain(".");

      const verified = verifyInstagramAuthState(state, secretKey);
      expect(verified.studioId).toBe(samplePayload.studioId);
      expect(verified.userId).toBe(samplePayload.userId);
      expect(verified.timestamp).toBeGreaterThan(0);
      expect(verified.nonce).toBeDefined();
    });

    it("throws InstagramOAuthConfigurationError when state secret is not configured", () => {
      const origInsta = process.env.INSTAGRAM_STATE_SECRET;
      const origMeta = process.env.META_APP_SECRET;
      const origAuth = process.env.BETTER_AUTH_SECRET;

      delete process.env.INSTAGRAM_STATE_SECRET;
      delete process.env.META_APP_SECRET;
      delete process.env.BETTER_AUTH_SECRET;

      try {
        expect(() => resolveSecret()).toThrow(InstagramOAuthConfigurationError);
        expect(() => generateInstagramAuthState(samplePayload)).toThrow(
          InstagramOAuthConfigurationError
        );
        expect(() => verifyInstagramAuthState("some.state")).toThrow(
          InstagramOAuthConfigurationError
        );
      } finally {
        if (origInsta) process.env.INSTAGRAM_STATE_SECRET = origInsta;
        if (origMeta) process.env.META_APP_SECRET = origMeta;
        if (origAuth) process.env.BETTER_AUTH_SECRET = origAuth;
      }
    });

    it("fails verification if state signature is tampered with (forged state)", () => {
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

    it("fails verification if state is expired (> 15 minutes)", () => {
      // Create state with timestamp 16 minutes in the past
      const expiredPayload = {
        ...samplePayload,
        timestamp: Date.now() - 16 * 60 * 1000,
        nonce: "test-nonce-expired",
      };
      const encoded = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
      const sig = createHmac("sha256", secretKey).update(encoded).digest("base64url");
      const expiredState = `${encoded}.${sig}`;

      expect(() => verifyInstagramAuthState(expiredState, secretKey)).toThrow(
        "OAuth state has expired"
      );
    });

    it("successfully claims state nonce once and rejects replay (single-use state)", async () => {
      const mockExecutor = createMockExecutor();
      const state = generateInstagramAuthState(samplePayload, secretKey);
      const parsed = verifyInstagramAuthState(state, secretKey);

      // Store nonce
      await storeInstagramOAuthNonce(
        parsed.nonce,
        parsed.studioId,
        parsed.userId,
        mockExecutor as any
      );

      // 1st consumption: success
      const consumed = await verifyAndConsumeInstagramAuthState(state, {
        secretKey,
        executor: mockExecutor as any,
        expectedStudioId: samplePayload.studioId,
        expectedUserId: samplePayload.userId,
      });
      expect(consumed.nonce).toBe(parsed.nonce);

      // 2nd consumption (replay attack): fails
      await expect(
        verifyAndConsumeInstagramAuthState(state, {
          secretKey,
          executor: mockExecutor as any,
          expectedStudioId: samplePayload.studioId,
          expectedUserId: samplePayload.userId,
        })
      ).rejects.toThrow("OAuth state has already been used or is expired");
    });

    it("rejects state when expected user or studio mismatch (foreign session / cross-studio attack)", async () => {
      const mockExecutor = createMockExecutor();
      const state = generateInstagramAuthState(samplePayload, secretKey);
      const parsed = verifyInstagramAuthState(state, secretKey);

      await storeInstagramOAuthNonce(
        parsed.nonce,
        parsed.studioId,
        parsed.userId,
        mockExecutor as any
      );

      // User mismatch
      await expect(
        verifyAndConsumeInstagramAuthState(state, {
          secretKey,
          executor: mockExecutor as any,
          expectedUserId: "different-user-999",
        })
      ).rejects.toThrow("OAuth state user mismatch");

      // Studio mismatch
      await expect(
        verifyAndConsumeInstagramAuthState(state, {
          secretKey,
          executor: mockExecutor as any,
          expectedStudioId: "999e4567-e89b-12d3-a456-426614174999",
        })
      ).rejects.toThrow("OAuth state studio mismatch");
    });

    it("handles parallel requests race condition so only one can claim state", async () => {
      const mockExecutor = createMockExecutor();
      const state = generateInstagramAuthState(samplePayload, secretKey);
      const parsed = verifyInstagramAuthState(state, secretKey);

      await storeInstagramOAuthNonce(
        parsed.nonce,
        parsed.studioId,
        parsed.userId,
        mockExecutor as any
      );

      const [res1, res2] = await Promise.allSettled([
        verifyAndConsumeInstagramAuthState(state, {
          secretKey,
          executor: mockExecutor as any,
        }),
        verifyAndConsumeInstagramAuthState(state, {
          secretKey,
          executor: mockExecutor as any,
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
      const rejected = [res1, res2].filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });

  describe("2. Meta Authorization URL Generation", () => {
    it("constructs full Meta OAuth URL with required permissions and state", async () => {
      const url = await generateMetaAuthUrl({
        studioId: samplePayload.studioId,
        userId: samplePayload.userId,
        redirectUri: "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
        clientId: "meta-app-id-98765",
        stateSecret: secretKey,
        skipPersistNonce: true,
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

    it("includes config_id when specified", async () => {
      const url = await generateMetaAuthUrl({
        studioId: samplePayload.studioId,
        userId: samplePayload.userId,
        redirectUri: "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
        clientId: "meta-app-id-98765",
        configId: "meta_config_12345",
        stateSecret: secretKey,
        skipPersistNonce: true,
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

    it("handles failure during code exchange cleanly without leaking secrets", async () => {
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

    it("throws configuration error if clientId or clientSecret is missing for code exchange", async () => {
      await expect(
        exchangeMetaAuthCode(
          "some_code",
          "https://pmu-crm.vercel.app/api/integrations/instagram/callback",
          { clientId: "", clientSecret: "" }
        )
      ).rejects.toThrow("Meta App ID and Secret must be configured");
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

    it("returns empty array and NEVER falls back to Facebook User ID when /me/accounts is empty", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [],
        }),
      });

      const discovered = await fetchInstagramAccountDetails(
        "user_access_token_123",
        mockFetch as unknown as typeof fetch
      );

      expect(discovered).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Ensure /me was NOT called
      expect(mockFetch.mock.calls[0][0]).toContain("/me/accounts");
      expect(mockFetch.mock.calls[0][0]).not.toContain("/me?");
    });

    it("ignores pages without instagram_business_account or with invalid id", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "page_without_ig",
              name: "Only Facebook Page",
              access_token: "page_token_1",
            },
            {
              id: "page_with_empty_ig",
              name: "Page Empty IG",
              access_token: "page_token_2",
              instagram_business_account: {
                id: "   ",
              },
            },
          ],
        }),
      });

      const discovered = await fetchInstagramAccountDetails(
        "user_access_token_123",
        mockFetch as unknown as typeof fetch
      );

      expect(discovered).toHaveLength(0);
    });
  });
});
