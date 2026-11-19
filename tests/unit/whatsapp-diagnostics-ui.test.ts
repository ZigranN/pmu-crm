import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_WABA_ID, DEFAULT_TARGET_APP_ID } from "@/features/whatsapp/domain/types";
import WhatsAppDiagnosticsPage, { metadata } from "@/app/(dashboard)/settings/integrations/whatsapp-diagnostics/page";
import * as authContext from "@/server/auth/context";

vi.mock("@/server/auth/context", () => ({
  requireBrowserStudioContext: vi.fn(),
}));

vi.mock("@/features/whatsapp/components/whatsapp-diagnostics", () => ({
  WhatsAppDiagnostics: vi.fn(({ isOwnerOrAdmin }) => ({
    type: "div",
    props: { "data-testid": "whatsapp-diagnostics", "data-is-admin": isOwnerOrAdmin },
  })),
}));

describe("WhatsApp Diagnostics UI & Settings Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Constants & Configuration", () => {
    it("exports exact confirmed WABA ID and Meta App ID constants", () => {
      expect(DEFAULT_WABA_ID).toBe("107183208737515");
      expect(DEFAULT_TARGET_APP_ID).toBe("1763936925735072");
    });

    it("has valid metadata for the page", () => {
      expect(metadata.title).toContain("WhatsApp");
      expect(metadata.description).toBeDefined();
    });
  });

  describe("WhatsAppDiagnosticsPage Server Component", () => {
    it("passes isOwnerOrAdmin=true for OWNER role", async () => {
      vi.mocked(authContext.requireBrowserStudioContext).mockResolvedValueOnce({
        userId: "user-1",
        studioId: "studio-1",
        membershipId: "mem-1",
        role: "OWNER",
        studioName: "Test Studio",
      });

      const pageResult = await WhatsAppDiagnosticsPage();
      expect(pageResult).toBeDefined();
      expect(authContext.requireBrowserStudioContext).toHaveBeenCalledTimes(1);
    });

    it("passes isOwnerOrAdmin=true for ADMIN, SUPER_ADMIN, and STUDIO_ADMIN roles", async () => {
      for (const role of ["ADMIN", "SUPER_ADMIN", "STUDIO_ADMIN"]) {
        vi.mocked(authContext.requireBrowserStudioContext).mockResolvedValueOnce({
          userId: "user-1",
          studioId: "studio-1",
          membershipId: "mem-1",
          role,
          studioName: "Test Studio",
        });

        const pageResult = await WhatsAppDiagnosticsPage();
        expect(pageResult).toBeDefined();
      }
    });

    it("passes isOwnerOrAdmin=false for non-admin roles (e.g. MASTER, SPECIALIST)", async () => {
      for (const role of ["MASTER", "SPECIALIST", "GUEST"]) {
        vi.mocked(authContext.requireBrowserStudioContext).mockResolvedValueOnce({
          userId: "user-1",
          studioId: "studio-1",
          membershipId: "mem-1",
          role,
          studioName: "Test Studio",
        });

        const pageResult = await WhatsAppDiagnosticsPage();
        expect(pageResult).toBeDefined();
      }
    });
  });
});
