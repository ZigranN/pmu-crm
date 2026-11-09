import { describe, expect, it } from "vitest";
import {
  generateGoogleAuthState,
  verifyGoogleAuthState,
  generateGoogleAuthUrl,
} from "@/features/google-calendar/server/oauth";

describe("Google OAuth State & URL generator", () => {
  const secretKey = "test-oauth-signing-secret-key-32b!";
  const samplePayload = {
    studioId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "user-123",
    masterId: "123e4567-e89b-12d3-a456-426614174001",
  };

  it("generates and verifies valid OAuth state token", () => {
    const state = generateGoogleAuthState(samplePayload, secretKey);
    expect(state).toContain(".");

    const verified = verifyGoogleAuthState(state, secretKey);
    expect(verified.studioId).toBe(samplePayload.studioId);
    expect(verified.userId).toBe(samplePayload.userId);
    expect(verified.masterId).toBe(samplePayload.masterId);
    expect(verified.timestamp).toBeGreaterThan(0);
    expect(verified.nonce).toBeDefined();
  });

  it("fails verification if state is tampered with", () => {
    const state = generateGoogleAuthState(samplePayload, secretKey);
    const [payload, sig] = state.split(".");
    // Tamper payload
    const tampered = `a${payload}.${sig}`;

    expect(() => verifyGoogleAuthState(tampered, secretKey)).toThrow();
  });

  it("fails verification if wrong secret key is used", () => {
    const state = generateGoogleAuthState(samplePayload, secretKey);
    expect(() => verifyGoogleAuthState(state, "wrong-secret-key")).toThrow();
  });

  it("constructs full Google auth URL correctly", () => {
    const url = generateGoogleAuthUrl({
      studioId: samplePayload.studioId,
      userId: samplePayload.userId,
      masterId: samplePayload.masterId,
      redirectUri: "http://localhost:3000/api/integrations/google-calendar/callback",
      clientId: "google-client-id-123.apps.googleusercontent.com",
      stateSecret: secretKey,
    });

    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("google-client-id-123.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/google-calendar/callback");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");

    const stateParam = parsed.searchParams.get("state");
    expect(stateParam).toBeDefined();
    const verified = verifyGoogleAuthState(stateParam!, secretKey);
    expect(verified.studioId).toBe(samplePayload.studioId);
  });
});
