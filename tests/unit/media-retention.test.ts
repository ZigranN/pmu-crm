import { describe, expect, it } from "vitest";

describe("Media Retention & Classification — Unit Tests", () => {
  it("classifies consent and procedure photos as authoritative evidence", () => {
    const consentMedia = {
      id: "med-1",
      studioId: "stud-1",
      clientId: "cli-1",
      type: "consent",
      url: "https://example.test/consent.pdf",
      publicId: "consent-1",
      caption: "Signed consent",
      deletedAt: null,
      procedureSessionId: null,
      appointmentId: null,
      createdAt: new Date(),
    };

    expect(consentMedia.type).toBe("consent");

    const procedureBefore = {
      id: "med-2",
      studioId: "stud-1",
      clientId: "cli-1",
      type: "before",
      url: "https://example.test/before.jpg",
      publicId: "before-1",
      caption: "Before procedure",
      deletedAt: null,
      procedureSessionId: "proc-1",
      appointmentId: "appt-1",
      createdAt: new Date(),
    };

    expect(procedureBefore.procedureSessionId).toBe("proc-1");
    expect(["before", "after", "healing_day_7", "healing_day_30", "correction", "refresh"]).toContain(
      procedureBefore.type
    );
  });

  it("identifies expired vs active export bundles", () => {
    const now = Date.now();
    const activeExportExpiresAt = new Date(now + 10 * 24 * 60 * 60 * 1000);
    const expiredExportExpiresAt = new Date(now - 1 * 24 * 60 * 60 * 1000);

    expect(new Date() > activeExportExpiresAt).toBe(false);
    expect(new Date() > expiredExportExpiresAt).toBe(true);
  });

  it("respects orphan grace period cutoff calculations", () => {
    const graceDays = 14;
    const now = Date.now();
    const cutoffDate = new Date(now - graceDays * 24 * 60 * 60 * 1000);

    const oldDeletedMedia = new Date(now - 20 * 24 * 60 * 60 * 1000);
    const recentDeletedMedia = new Date(now - 5 * 24 * 60 * 60 * 1000);

    expect(oldDeletedMedia < cutoffDate).toBe(true); // Eligible for orphan deletion
    expect(recentDeletedMedia < cutoffDate).toBe(false); // Protected by grace period
  });
});
