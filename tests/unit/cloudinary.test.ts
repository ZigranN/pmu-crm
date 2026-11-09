import { describe, expect, it, vi } from "vitest";
import { resolveProviderDelivery } from "@/app/api/media/[id]/content/route";

// Unmock @/lib/cloudinary for this unit test so we test the real implementation
vi.unmock("@/lib/cloudinary");

describe("Cloudinary Authenticated Delivery Unit Tests", () => {
  it("generates signed authenticated delivery URL for images with sign_url: true", async () => {
    const { getSignedCloudinaryDeliveryUrl, cloudinary } = await import("@/lib/cloudinary");
    const spy = vi.spyOn(cloudinary, "url");

    const signedUrl = getSignedCloudinaryDeliveryUrl("crm-pmu/studio-1/before/asset-123", {
      resource_type: "image",
    });

    expect(spy).toHaveBeenCalledWith(
      "crm-pmu/studio-1/before/asset-123",
      expect.objectContaining({
        type: "authenticated",
        resource_type: "image",
        sign_url: true,
        secure: true,
      })
    );

    expect(signedUrl).toContain("https://res.cloudinary.com/test-only/image/authenticated/");
    expect(signedUrl).toContain("/crm-pmu/studio-1/before/asset-123");
    spy.mockRestore();
  });

  it("generates signed authenticated delivery URL for raw files (PDF) with sign_url: true", async () => {
    const { getSignedCloudinaryDeliveryUrl, cloudinary } = await import("@/lib/cloudinary");
    const spy = vi.spyOn(cloudinary, "url");

    const signedUrl = getSignedCloudinaryDeliveryUrl("crm-pmu/studio-1/consent/consent-456.pdf", {
      resource_type: "raw",
    });

    expect(spy).toHaveBeenCalledWith(
      "crm-pmu/studio-1/consent/consent-456.pdf",
      expect.objectContaining({
        type: "authenticated",
        resource_type: "raw",
        sign_url: true,
        secure: true,
      })
    );

    expect(signedUrl).toContain("https://res.cloudinary.com/test-only/raw/authenticated/");
    expect(signedUrl).toContain("/crm-pmu/studio-1/consent/consent-456.pdf");
    spy.mockRestore();
  });

  describe("resolveProviderDelivery", () => {
    it("resolves authenticated image URL", () => {
      const result = resolveProviderDelivery(
        "https://res.cloudinary.com/crm-pmu/image/authenticated/s--abc123--/v1/crm-pmu/st1/before/img.jpg"
      );
      expect(result).toEqual({
        resourceType: "image",
        deliveryType: "authenticated",
      });
    });

    it("resolves authenticated raw PDF URL", () => {
      const result = resolveProviderDelivery(
        "https://res.cloudinary.com/crm-pmu/raw/authenticated/s--xyz789--/v1/crm-pmu/st1/consent/doc.pdf"
      );
      expect(result).toEqual({
        resourceType: "raw",
        deliveryType: "authenticated",
      });
    });

    it("resolves legacy upload image URL", () => {
      const result = resolveProviderDelivery(
        "https://res.cloudinary.com/crm-pmu/image/upload/v12345/crm-pmu/st1/after/img.jpg"
      );
      expect(result).toEqual({
        resourceType: "image",
        deliveryType: "upload",
      });
    });

    it("resolves legacy upload raw PDF URL", () => {
      const result = resolveProviderDelivery(
        "https://res.cloudinary.com/crm-pmu/raw/upload/v12345/crm-pmu/st1/consent/consent.pdf"
      );
      expect(result).toEqual({
        resourceType: "raw",
        deliveryType: "upload",
      });
    });

    it("fails closed (returns null) for unrecognized or arbitrary URLs", () => {
      expect(resolveProviderDelivery("https://example.test/arbitrary/path.jpg")).toBeNull();
      expect(resolveProviderDelivery("https://res.cloudinary.com/crm-pmu/video/upload/video.mp4")).toBeNull();
      expect(resolveProviderDelivery("ftp://something.invalid")).toBeNull();
      expect(resolveProviderDelivery("")).toBeNull();
    });
  });
});
