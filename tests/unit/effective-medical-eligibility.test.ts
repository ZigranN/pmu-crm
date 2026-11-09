import { describe, expect, it } from "vitest";
import {
  evaluateEffectiveMedicalEligibility,
  normalizeMedicalProfileSnapshot,
  hasMedicalProfileSnapshotMismatch,
  isTerminalCycleStage,
  type EffectiveMedicalEligibilityInput,
} from "@/features/medical/domain/effective-eligibility";

describe("Effective Medical Eligibility Domain Evaluator", () => {
  const defaultProfile = {
    allergies: "Pollen",
    contraindications: null,
    skinType: "Fitzpatrick II",
    pregnancyStatus: null,
    medications: "Antihistamines",
    previousPMUNotes: null,
    medicalNotes: "Occasional seasonal allergies",
    previousPMU: false,
    herpesHistory: false,
    diabetes: false,
    bloodThinners: false,
    keloidRisk: false,
    autoimmuneDiseases: false,
    recentBotoxFillers: false,
    recentPeelingLaser: false,
    skinSensitivity: true,
    mergeReviewRequired: false,
  };

  const defaultRevisionSnapshot = normalizeMedicalProfileSnapshot(defaultProfile);

  const defaultRevision = {
    id: "rev-101",
    clientId: "client-001",
    revisionNumber: 1,
    snapshot: defaultRevisionSnapshot,
  };

  const defaultClearance = {
    id: "clearance-501",
    cycleId: "cycle-001",
    medicalRevisionId: "rev-101",
    decisionNumber: 1,
    decision: "CLEARED" as const,
  };

  it("1. No medical profile -> REVIEW_REQUIRED / NO_MEDICAL_PROFILE", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "qualification",
      currentMedicalProfile: null,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("NO_MEDICAL_PROFILE");
    expect(result.isTerminalCycle).toBe(false);
    expect(result.currentMedicalRevisionId).toBe("rev-101");
  });

  it("2. Profile exists without revision -> REVIEW_REQUIRED / NO_MEDICAL_REVISION", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "qualification",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: null,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("NO_MEDICAL_REVISION");
    expect(result.isTerminalCycle).toBe(false);
    expect(result.currentMedicalRevisionId).toBeNull();
    expect(result.currentMedicalRevisionNumber).toBeNull();
  });

  it("3. Revision exists but no clearance -> REVIEW_REQUIRED / NO_CLEARANCE", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: null,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("NO_CLEARANCE");
    expect(result.isTerminalCycle).toBe(false);
    expect(result.latestClearanceId).toBeNull();
    expect(result.humanDecision).toBeNull();
  });

  it("4. Valid CLEARED -> status CLEARED / reasonCode CLEARED", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-501",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 1,
        decision: "CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("CLEARED");
    expect(result.reasonCode).toBe("CLEARED");
    expect(result.isTerminalCycle).toBe(false);
    expect(result.currentMedicalRevisionId).toBe("rev-101");
    expect(result.currentMedicalRevisionNumber).toBe(1);
    expect(result.latestClearanceId).toBe("clearance-501");
    expect(result.clearanceMedicalRevisionId).toBe("rev-101");
    expect(result.decisionNumber).toBe(1);
    expect(result.humanDecision).toBe("CLEARED");
  });

  it("5. Valid CONSULTATION_REQUIRED -> status CONSULTATION_REQUIRED / reasonCode CONSULTATION_REQUIRED", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "qualification",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-502",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 1,
        decision: "CONSULTATION_REQUIRED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("CONSULTATION_REQUIRED");
    expect(result.reasonCode).toBe("CONSULTATION_REQUIRED");
    expect(result.humanDecision).toBe("CONSULTATION_REQUIRED");
  });

  it("6. Valid NOT_CLEARED -> status NOT_CLEARED / reasonCode NOT_CLEARED", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "qualification",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-503",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 1,
        decision: "NOT_CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_CLEARED");
    expect(result.reasonCode).toBe("NOT_CLEARED");
    expect(result.humanDecision).toBe("NOT_CLEARED");
  });

  it("7. Clearance references superseded revision -> REVIEW_REQUIRED / MEDICAL_REVISION_CHANGED", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: {
        id: "rev-102",
        clientId: "client-001",
        revisionNumber: 2,
        snapshot: defaultRevisionSnapshot,
      },
      latestCycleMedicalClearance: {
        id: "clearance-501",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101", // Superseded!
        decisionNumber: 1,
        decision: "CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("MEDICAL_REVISION_CHANGED");
    expect(result.currentMedicalRevisionId).toBe("rev-102");
    expect(result.clearanceMedicalRevisionId).toBe("rev-101");
    expect(result.humanDecision).toBe("CLEARED");
  });

  it("8. Merge review flag is true -> REVIEW_REQUIRED / MERGE_REVIEW_REQUIRED", () => {
    // Test both top-level mergeReviewRequired and profile.mergeReviewRequired
    const input1: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: {
        ...defaultProfile,
        mergeReviewRequired: true,
      },
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result1 = evaluateEffectiveMedicalEligibility(input1);
    expect(result1.status).toBe("REVIEW_REQUIRED");
    expect(result1.reasonCode).toBe("MERGE_REVIEW_REQUIRED");

    const input2: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
      mergeReviewRequired: true,
    };

    const result2 = evaluateEffectiveMedicalEligibility(input2);
    expect(result2.status).toBe("REVIEW_REQUIRED");
    expect(result2.reasonCode).toBe("MERGE_REVIEW_REQUIRED");
  });

  it("9. Revision belongs to a different client -> REVIEW_REQUIRED / CLIENT_REVISION_MISMATCH", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "target-client-002",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: {
        id: "rev-101",
        clientId: "source-client-001", // Foreign client ownership!
        revisionNumber: 1,
        snapshot: defaultRevisionSnapshot,
      },
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("CLIENT_REVISION_MISMATCH");
    expect(result.clientId).toBe("target-client-002");
  });

  it("10. Profile snapshot differs from latest revision -> REVIEW_REQUIRED / PROFILE_REVISION_MISMATCH", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: {
        ...defaultProfile,
        diabetes: true, // Modified in profile without a new revision!
      },
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("PROFILE_REVISION_MISMATCH");
  });

  it("11. Profile snapshot matches after normalization -> evaluates correctly", () => {
    // Extra technical metadata / non-snapshot fields in profile should not cause mismatch
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: {
        ...defaultProfile,
        id: "profile-uuid",
        studioId: "studio-uuid",
        createdAt: new Date(),
        updatedAt: new Date(),
        // Undefined text field matches null snapshot
        contraindications: undefined,
      },
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("CLEARED");
    expect(result.reasonCode).toBe("CLEARED");
  });

  it("12. Terminal cycle_completed -> NOT_APPLICABLE / CYCLE_TERMINAL", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "cycle_completed",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reasonCode).toBe("CYCLE_TERMINAL");
    expect(result.isTerminalCycle).toBe(true);
  });

  it("13. Terminal lost -> NOT_APPLICABLE / CYCLE_TERMINAL", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "lost",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reasonCode).toBe("CYCLE_TERMINAL");
    expect(result.isTerminalCycle).toBe(true);
  });

  it("14. Terminal refresh_no_response -> NOT_APPLICABLE / CYCLE_TERMINAL", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "refresh_no_response",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: defaultClearance,
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reasonCode).toBe("CYCLE_TERMINAL");
    expect(result.isTerminalCycle).toBe(true);
  });

  it("15. Terminal cycle retains historical human decision metadata but returns NOT_APPLICABLE", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "cycle_completed",
      currentMedicalProfile: null, // Even without active profile
      currentMedicalRevision: {
        id: "rev-101",
        clientId: "client-001",
        revisionNumber: 1,
        snapshot: defaultRevisionSnapshot,
      },
      latestCycleMedicalClearance: {
        id: "clearance-historical",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 2,
        decision: "CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_APPLICABLE");
    expect(result.reasonCode).toBe("CYCLE_TERMINAL");
    expect(result.isTerminalCycle).toBe(true);
    expect(result.latestClearanceId).toBe("clearance-historical");
    expect(result.decisionNumber).toBe(2);
    expect(result.humanDecision).toBe("CLEARED");
    expect(result.currentMedicalRevisionId).toBe("rev-101");
  });

  it("16. Same-revision latest decision CLEARED replaces earlier CONSULTATION_REQUIRED", () => {
    // Evaluator takes latestCycleMedicalClearance (which is decisionNumber 2: CLEARED)
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-decision-2",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 2,
        decision: "CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("CLEARED");
    expect(result.reasonCode).toBe("CLEARED");
    expect(result.decisionNumber).toBe(2);
    expect(result.humanDecision).toBe("CLEARED");
  });

  it("17. Latest NOT_CLEARED is not overridden by an older CLEARED", () => {
    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-decision-3",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101",
        decisionNumber: 3,
        decision: "NOT_CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("NOT_CLEARED");
    expect(result.reasonCode).toBe("NOT_CLEARED");
    expect(result.decisionNumber).toBe(3);
    expect(result.humanDecision).toBe("NOT_CLEARED");
  });

  it("18. Independent parallel cycles produce independent outputs", () => {
    // Cycle A cleared on rev-101
    const cycleAInput: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-A",
      clientId: "client-001",
      cycleStage: "procedure_confirmed",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: {
        id: "clearance-A",
        cycleId: "cycle-A",
        medicalRevisionId: "rev-101",
        decisionNumber: 1,
        decision: "CLEARED",
      },
    };

    // Cycle B has no clearance yet
    const cycleBInput: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-B",
      clientId: "client-001",
      cycleStage: "new_lead",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: null,
    };

    const resultA = evaluateEffectiveMedicalEligibility(cycleAInput);
    const resultB = evaluateEffectiveMedicalEligibility(cycleBInput);

    expect(resultA.status).toBe("CLEARED");
    expect(resultA.reasonCode).toBe("CLEARED");
    expect(resultA.cycleId).toBe("cycle-A");

    expect(resultB.status).toBe("REVIEW_REQUIRED");
    expect(resultB.reasonCode).toBe("NO_CLEARANCE");
    expect(resultB.cycleId).toBe("cycle-B");
  });

  it("19. Metadata-only medical revision change requires review", () => {
    // Only medicalNotes was updated, creating rev-102
    const updatedProfile = {
      ...defaultProfile,
      medicalNotes: "Client mentioned minor skin redness last week",
    };
    const updatedRevisionSnapshot = normalizeMedicalProfileSnapshot(updatedProfile);

    const input: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: updatedProfile,
      currentMedicalRevision: {
        id: "rev-102",
        clientId: "client-001",
        revisionNumber: 2,
        snapshot: updatedRevisionSnapshot,
      },
      latestCycleMedicalClearance: {
        id: "clearance-501",
        cycleId: "cycle-001",
        medicalRevisionId: "rev-101", // Cleared on old revision!
        decisionNumber: 1,
        decision: "CLEARED",
      },
    };

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("MEDICAL_REVISION_CHANGED");
    expect(result.currentMedicalRevisionId).toBe("rev-102");
    expect(result.clearanceMedicalRevisionId).toBe("rev-101");
  });

  it("20. Evaluator produces no mutations to supplied input objects", () => {
    const input: EffectiveMedicalEligibilityInput = Object.freeze({
      cycleId: "cycle-001",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: Object.freeze({ ...defaultProfile }),
      currentMedicalRevision: Object.freeze({
        id: "rev-101",
        clientId: "client-001",
        revisionNumber: 1,
        snapshot: Object.freeze({ ...defaultRevisionSnapshot }),
      }),
      latestCycleMedicalClearance: Object.freeze({ ...defaultClearance }),
      mergeReviewRequired: false,
    });

    const result = evaluateEffectiveMedicalEligibility(input);
    expect(result.status).toBe("CLEARED");
    expect(result.reasonCode).toBe("CLEARED");
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.currentMedicalProfile)).toBe(true);
    expect(Object.isFrozen(input.currentMedicalRevision)).toBe(true);
  });

  it("21. Clearance belonging to a different cycle yields REVIEW_REQUIRED / CLEARANCE_CYCLE_MISMATCH", () => {
    // Cycle A and Cycle B belong to the same client and reference the same current revision rev-101.
    // Cycle B has a valid CLEARED decision.
    const clearanceCycleB = {
      id: "clearance-B",
      cycleId: "cycle-B",
      medicalRevisionId: "rev-101",
      decisionNumber: 1,
      decision: "CLEARED" as const,
    };

    // Pass B's clearance into Cycle A's evaluator
    const inputCycleA: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-A",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: clearanceCycleB,
    };

    const result = evaluateEffectiveMedicalEligibility(inputCycleA);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasonCode).toBe("CLEARANCE_CYCLE_MISMATCH");
    expect(result.cycleId).toBe("cycle-A");
    expect(result.latestClearanceId).toBe("clearance-B");
    expect(result.clearanceMedicalRevisionId).toBe("rev-101");
    expect(result.humanDecision).toBe("CLEARED");
  });

  it("22. Valid clearance belonging to Cycle A with current revision resolves normally to CLEARED", () => {
    // A valid clearance belonging to Cycle A with current revision resolves normally to CLEARED.
    const clearanceCycleA = {
      id: "clearance-A",
      cycleId: "cycle-A",
      medicalRevisionId: "rev-101",
      decisionNumber: 1,
      decision: "CLEARED" as const,
    };

    const inputCycleA: EffectiveMedicalEligibilityInput = {
      cycleId: "cycle-A",
      clientId: "client-001",
      cycleStage: "procedure_slot_selected",
      currentMedicalProfile: defaultProfile,
      currentMedicalRevision: defaultRevision,
      latestCycleMedicalClearance: clearanceCycleA,
    };

    const result = evaluateEffectiveMedicalEligibility(inputCycleA);
    expect(result.status).toBe("CLEARED");
    expect(result.reasonCode).toBe("CLEARED");
    expect(result.cycleId).toBe("cycle-A");
    expect(result.latestClearanceId).toBe("clearance-A");
    expect(result.clearanceMedicalRevisionId).toBe("rev-101");
    expect(result.decisionNumber).toBe(1);
    expect(result.humanDecision).toBe("CLEARED");
  });

  describe("Helper function validation", () => {
    it("isTerminalCycleStage identifies canonical terminal stages correctly", () => {
      expect(isTerminalCycleStage("cycle_completed")).toBe(true);
      expect(isTerminalCycleStage("refresh_no_response")).toBe(true);
      expect(isTerminalCycleStage("lost")).toBe(true);

      expect(isTerminalCycleStage("new_lead")).toBe(false);
      expect(isTerminalCycleStage("qualification")).toBe(false);
      expect(isTerminalCycleStage("procedure_confirmed")).toBe(false);
      expect(isTerminalCycleStage("first_session_completed")).toBe(false);
    });

    it("hasMedicalProfileSnapshotMismatch checks differences across 16 fields", () => {
      expect(
        hasMedicalProfileSnapshotMismatch(defaultProfile, defaultRevisionSnapshot)
      ).toBe(false);

      expect(
        hasMedicalProfileSnapshotMismatch(
          { ...defaultProfile, allergies: "Latex" },
          defaultRevisionSnapshot
        )
      ).toBe(true);

      expect(
        hasMedicalProfileSnapshotMismatch(
          { ...defaultProfile, keloidRisk: true },
          defaultRevisionSnapshot
        )
      ).toBe(true);
    });
  });
});
