import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkWhatsAppSubscribedApps,
  subscribeWhatsAppAppToWaba,
  isAppSubscribedInData,
  sanitizeMetaErrorMessage,
  DEFAULT_WABA_ID,
  DEFAULT_TARGET_APP_ID,
  GRAPH_API_VERSION,
} from "@/features/whatsapp/server/diagnostic";
import { GET, POST } from "@/app/api/admin/diagnostics/whatsapp/route";

vi.mock("@/server/auth/context", () => ({
  readSession: vi.fn(),
  getUserActiveStudios: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {},
}));

import { readSession, getUserActiveStudios } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";

describe("WhatsApp Subscribed Apps Diagnostic Service", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("sanitizeMetaErrorMessage", () => {
    it("redacts tokens matching EAAG/EAAB patterns", () => {
      const msg = "Invalid OAuth access token: EAAG1234567890abcdef1234567890.";
      const sanitized = sanitizeMetaErrorMessage(msg);
      expect(sanitized).not.toContain("EAAG1234567890abcdef1234567890");
      expect(sanitized).toContain("[REDACTED_TOKEN]");
    });

    it("redacts Bearer token headers in error messages", () => {
      const msg = "Failed request with Bearer secret_meta_token_123456789";
      const sanitized = sanitizeMetaErrorMessage(msg);
      expect(sanitized).not.toContain("secret_meta_token_123456789");
      expect(sanitized).toContain("Bearer [REDACTED_TOKEN]");
    });

    it("redacts access_token query param in error messages", () => {
      const msg = "Error requesting url https://graph.facebook.com/?access_token=EAAB1234567890";
      const sanitized = sanitizeMetaErrorMessage(msg);
      expect(sanitized).not.toContain("EAAB1234567890");
      expect(sanitized).toContain("access_token=[REDACTED_TOKEN]");
    });

    it("handles non-string or empty input safely", () => {
      expect(sanitizeMetaErrorMessage(null)).toBe("Unknown Meta API error");
      expect(sanitizeMetaErrorMessage(undefined)).toBe("Unknown Meta API error");
      expect(sanitizeMetaErrorMessage("")).toBe("Unknown Meta API error");
    });
  });

  describe("isAppSubscribedInData", () => {
    const targetAppId = "1763936925735072";

    it("detects app ID in top-level id field", () => {
      const data = [{ id: "1763936925735072", name: "PMU CRM" }];
      expect(isAppSubscribedInData(data, targetAppId)).toBe(true);
    });

    it("detects app ID inside whatsapp_business_api_data", () => {
      const data = [
        {
          whatsapp_business_api_data: {
            id: "1763936925735072",
            name: "PMU CRM App",
          },
        },
      ];
      expect(isAppSubscribedInData(data, targetAppId)).toBe(true);
    });

    it("detects app ID inside app object", () => {
      const data = [
        {
          app: {
            id: "1763936925735072",
          },
        },
      ];
      expect(isAppSubscribedInData(data, targetAppId)).toBe(true);
    });

    it("returns false if app ID is not present in data array", () => {
      const data = [
        { id: "9999999999999999", name: "Other App" },
        { whatsapp_business_api_data: { id: "8888888888888888" } },
      ];
      expect(isAppSubscribedInData(data, targetAppId)).toBe(false);
    });

    it("returns false for non-array or empty data", () => {
      expect(isAppSubscribedInData([], targetAppId)).toBe(false);
      expect(isAppSubscribedInData(null, targetAppId)).toBe(false);
      expect(isAppSubscribedInData(undefined, targetAppId)).toBe(false);
    });
  });

  describe("checkWhatsAppSubscribedApps", () => {
    it("returns tokenConfigured: false without calling network when WHATSAPP_ACCESS_TOKEN is missing", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      const mockFetch = vi.fn();

      const result = await checkWhatsAppSubscribedApps({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(false);
      expect(result.graphApiSuccess).toBe(false);
      expect(result.appSubscribed).toBe(false);
      expect(result.error?.message).toContain("WHATSAPP_ACCESS_TOKEN is not configured");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls Meta Graph API with correct URL and Bearer token, returning appSubscribed: true when found", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN_SECRET_123";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                whatsapp_business_api_data: {
                  id: "1763936925735072",
                  name: "PMU App",
                },
              },
            ],
          }),
      });

      const result = await checkWhatsAppSubscribedApps({ fetchFn: mockFetch });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${DEFAULT_WABA_ID}/subscribed_apps`,
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer EAAG_TEST_TOKEN_SECRET_123",
            Accept: "application/json",
          },
          cache: "no-store",
        })
      );

      expect(result).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        appSubscribed: true,
        error: null,
      });
    });

    it("returns appSubscribed: false when target app is not in subscribed_apps response", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [] }),
      });

      const result = await checkWhatsAppSubscribedApps({ fetchFn: mockFetch });

      expect(result).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        appSubscribed: false,
        error: null,
      });
    });

    it("sanitizes and returns Meta Graph API error details when API returns failure status", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Error validating access token: Session has expired on Nov 19. Token: EAAG_SECRET_LEAK_TEST",
              type: "OAuthException",
              code: 190,
              error_subcode: 463,
              fbtrace_id: "AI_trace_secret",
            },
          }),
      });

      const result = await checkWhatsAppSubscribedApps({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(true);
      expect(result.graphApiSuccess).toBe(false);
      expect(result.appSubscribed).toBe(false);
      expect(result.error?.code).toBe(190);
      expect(result.error?.subcode).toBe(463);
      expect(result.error?.type).toBe("OAuthException");
      expect(result.error?.message).not.toContain("EAAG_SECRET_LEAK_TEST");
      expect(result.error?.message).toContain("[REDACTED_TOKEN]");
      // fbtrace_id should not be returned in error response
      expect((result.error as any)?.fbtrace_id).toBeUndefined();
    });

    it("handles fetch network/abort errors cleanly", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection reset"));

      const result = await checkWhatsAppSubscribedApps({ fetchFn: mockFetch });

      expect(result).toEqual({
        tokenConfigured: true,
        graphApiSuccess: false,
        appSubscribed: false,
        error: {
          message: "Network connection reset",
        },
      });
    });
  });

  describe("GET /api/admin/diagnostics/whatsapp Endpoint", () => {
    it("returns 401 with no-store headers when unauthenticated", async () => {
      vi.mocked(readSession).mockResolvedValue(null as any);

      const response = await GET();
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json).toEqual({ error: "Authentication required" });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });

    it("returns 403 when authenticated user has no admin or owner roles", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "user-client-1", email: "client@test.com", role: "CLIENT" },
      } as any);
      vi.mocked(getUserActiveStudios).mockResolvedValue([
        { studioId: "studio-1", studioName: "Studio 1", membershipId: "m-1", role: "CLIENT" },
      ]);
      vi.mocked(hasPermission).mockResolvedValue(false);

      const response = await GET();
      expect(response.status).toBe(403);

      const json = await response.json();
      expect(json).toEqual({ error: "Forbidden: Administrator authorization required" });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });

    it("returns 200 with diagnostic payload when authenticated as OWNER user", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "user-admin-1", email: "admin@pmu.com", role: "OWNER" },
      } as any);
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_VALID_TOKEN";

      const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: DEFAULT_TARGET_APP_ID, name: "PMU CRM" }],
          }),
      } as any);

      const response = await GET();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        appSubscribed: true,
        error: null,
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");

      globalFetchSpy.mockRestore();
    });

    it("returns 200 when user has INTEGRATION_MANAGE permission in active studio", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "user-studio-admin-1", email: "manager@pmu.com", role: "CLIENT" },
      } as any);
      vi.mocked(getUserActiveStudios).mockResolvedValue([
        { studioId: "studio-123", studioName: "PMU Main", membershipId: "m-2", role: "MASTER" },
      ]);
      vi.mocked(hasPermission).mockResolvedValue(true);

      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_VALID_TOKEN";

      const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [],
          }),
      } as any);

      const response = await GET();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        appSubscribed: false,
        error: null,
      });

      globalFetchSpy.mockRestore();
    });
  });

  describe("subscribeWhatsAppAppToWaba Service", () => {
    it("returns unconfigured when WHATSAPP_ACCESS_TOKEN is missing", async () => {
      delete process.env.WHATSAPP_ACCESS_TOKEN;
      const mockFetch = vi.fn();

      const result = await subscribeWhatsAppAppToWaba({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(false);
      expect(result.graphApiSuccess).toBe(false);
      expect(result.subscribed).toBe(false);
      expect(result.appSubscribed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error?.message).toContain("WHATSAPP_ACCESS_TOKEN is not configured");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("executes POST to /subscribed_apps then re-checks GET /subscribed_apps and verifies app is present", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi
        .fn()
        // 1st call: POST /subscribed_apps
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        })
        // 2nd call: GET /subscribed_apps (recheck)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [
                {
                  id: DEFAULT_TARGET_APP_ID,
                  name: "PMU CRM",
                },
              ],
            }),
        });

      const result = await subscribeWhatsAppAppToWaba({ fetchFn: mockFetch });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${DEFAULT_WABA_ID}/subscribed_apps`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer EAAG_TEST_TOKEN",
          }),
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${DEFAULT_WABA_ID}/subscribed_apps`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer EAAG_TEST_TOKEN",
          }),
        })
      );

      expect(result).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        subscribed: true,
        appSubscribed: true,
        verified: true,
        wabaId: DEFAULT_WABA_ID,
        targetAppId: DEFAULT_TARGET_APP_ID,
        error: null,
      });
    });

    it("returns verified: false when POST succeeds but subsequent GET verification fails to find target app", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi
        .fn()
        // 1st call: POST /subscribed_apps
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        })
        // 2nd call: GET /subscribed_apps returns empty list
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [] }),
        });

      const result = await subscribeWhatsAppAppToWaba({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(true);
      expect(result.graphApiSuccess).toBe(true);
      expect(result.subscribed).toBe(true);
      expect(result.appSubscribed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error?.message).toContain("not found in GET /subscribed_apps verification check");
    });

    it("handles Meta error on POST and sanitizes error message without leaking tokens", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Invalid OAuth token EAAG_LEAK_SECRET_12345 provided",
              type: "OAuthException",
              code: 190,
              error_subcode: 463,
            },
          }),
      });

      const result = await subscribeWhatsAppAppToWaba({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(true);
      expect(result.graphApiSuccess).toBe(false);
      expect(result.subscribed).toBe(false);
      expect(result.appSubscribed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error?.code).toBe(190);
      expect(result.error?.message).not.toContain("EAAG_LEAK_SECRET_12345");
      expect(result.error?.message).toContain("[REDACTED_TOKEN]");
    });

    it("handles network error cleanly during POST execution", async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_TEST_TOKEN";
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));

      const result = await subscribeWhatsAppAppToWaba({ fetchFn: mockFetch });

      expect(result.tokenConfigured).toBe(true);
      expect(result.graphApiSuccess).toBe(false);
      expect(result.subscribed).toBe(false);
      expect(result.appSubscribed).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error?.message).toBe("Connection reset by peer");
    });
  });

  describe("POST /api/admin/diagnostics/whatsapp Endpoint", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(readSession).mockResolvedValue(null as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json).toEqual({ error: "Authentication required" });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    });

    it("rejects cross-site requests via Sec-Fetch-Site with 403", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "admin-1", role: "OWNER" },
      } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-site": "cross-site",
          origin: "https://evil.com",
        },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toContain("Cross-site or invalid origin request rejected");
    });

    it("rejects mismatched origin header with 403", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "admin-1", role: "OWNER" },
      } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "crm.example.com",
          origin: "https://attacker.com",
        },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toContain("Cross-site or invalid origin request rejected");
    });

    it("returns 403 when user only has generic INTEGRATION_MANAGE permission but not OWNER or ADMIN role", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "manager-1", role: "CLIENT" },
      } as any);
      vi.mocked(getUserActiveStudios).mockResolvedValue([
        { studioId: "s-1", studioName: "Studio", membershipId: "m-1", role: "MASTER" },
      ]);
      vi.mocked(hasPermission).mockResolvedValue(true); // Has INTEGRATION_MANAGE, but not OWNER/ADMIN

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "crm.example.com",
          origin: "https://crm.example.com",
        },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toContain("OWNER or ADMIN role required");
    });

    it("returns 400 when payload does not contain { confirm: true }", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "admin-1", role: "ADMIN" },
      } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ action: "subscribe" }), // missing confirm: true
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Explicit confirmation required");
    });

    it("returns 400 for malformed JSON body", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "admin-1", role: "ADMIN" },
      } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        body: "invalid-json{",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toContain("Invalid JSON payload");
    });

    it("successfully processes subscription when user is authenticated OWNER with explicit confirmation", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "owner-1", role: "OWNER" },
      } as any);
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_VALID_TOKEN";

      const globalFetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [{ id: DEFAULT_TARGET_APP_ID, name: "PMU CRM" }],
            }),
        } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json).toEqual({
        tokenConfigured: true,
        graphApiSuccess: true,
        subscribed: true,
        appSubscribed: true,
        verified: true,
        wabaId: DEFAULT_WABA_ID,
        targetAppId: DEFAULT_TARGET_APP_ID,
        error: null,
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");

      globalFetchSpy.mockRestore();
    });

    it("returns 502 when Meta Graph API returns an error during subscription", async () => {
      vi.mocked(readSession).mockResolvedValue({
        user: { id: "admin-1", role: "ADMIN" },
      } as any);
      process.env.WHATSAPP_ACCESS_TOKEN = "EAAG_VALID_TOKEN";

      const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Meta permission denied",
              type: "OAuthException",
              code: 200,
            },
          }),
      } as any);

      const request = new Request("http://localhost:3000/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ confirm: true }),
      });

      const response = await POST(request);
      expect(response.status).toBe(502);

      const json = await response.json();
      expect(json.tokenConfigured).toBe(true);
      expect(json.graphApiSuccess).toBe(false);
      expect(json.error?.code).toBe(200);
      expect(json.error?.message).toBe("Meta permission denied");

      globalFetchSpy.mockRestore();
    });
  });
});
