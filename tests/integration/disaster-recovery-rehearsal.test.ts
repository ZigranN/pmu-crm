import { describe, it, expect } from "vitest";
import { runDisasterRecoveryRehearsal } from "../../scripts/verify-disaster-recovery.mjs";

describe("Phase 18 Disaster Recovery Rehearsal Integration", () => {
  it("executes complete backup, clean restore, media verification, and outbox reclamation", async () => {
    const report = await runDisasterRecoveryRehearsal();

    expect(report.rehearsalResult).toBe("SUCCESS");
    expect(report.migrationsApplied).toBe(40);
    expect(report.migrationHead).toBe("0039_instagram_conversation_channel");
    expect(report.backupChecksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // Records integrity
    expect(report.recordsPreserved.studios).toBe(1);
    expect(report.recordsPreserved.clients).toBe(1);
    expect(report.recordsPreserved.cycles).toBe(1);
    expect(report.recordsPreserved.consents).toBe(1);
    expect(report.recordsPreserved.media).toBe(2);
    expect(report.recordsPreserved.appointments).toBe(1);
    expect(report.recordsPreserved.procedureSessions).toBe(1);
    expect(report.recordsPreserved.payments).toBe(1);
    expect(report.recordsPreserved.conversations).toBe(1);
    expect(report.recordsPreserved.googleMappings).toBe(1);
    expect(report.recordsPreserved.outboxJobs).toBe(5);
    expect(report.recordsPreserved.privacyRequests).toBe(1);

    // Media & Worker recovery
    expect(report.mediaIntegrity.manifestItems).toBe(2);
    expect(report.mediaIntegrity.filesVerified).toBe(2);
    expect(report.mediaIntegrity.consentHashesPreserved).toBe(true);

    expect(report.workerRecovery.expiredLeaseReclaimed).toBe(true);
    expect(report.workerRecovery.deadJobPreserved).toBe(true);
    expect(report.workerRecovery.completedJobUnchanged).toBe(true);
    expect(report.workerRecovery.futureJobPreserved).toBe(true);
  }, 45000);
});
