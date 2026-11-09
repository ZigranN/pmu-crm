import {
  type SuggestedAction,
  type SuggestedActionInput,
  type AllowedAdvisoryActionType,
  ALLOWED_ADVISORY_ACTION_TYPES,
  PROHIBITED_AUTONOMOUS_ACTIONS,
} from "../schemas/ai.schema";

export interface GuardrailContext {
  medicalClearanceStatus?: "ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE" | "UNKNOWN" | string;
  hasMedicalReviewRequired?: boolean;
  consentStatus?: "SIGNED" | "PENDING" | "EXPIRED" | "NOT_REQUIRED" | string;
  cycleStage?: string;
}

export interface GuardrailViolation {
  code: string;
  message: string;
  actionId?: string;
  prohibitedPattern?: string;
}

export class AiGuardrailViolationError extends Error {
  readonly violations: GuardrailViolation[];
  constructor(message: string, violations: GuardrailViolation[]) {
    super(message);
    this.name = "AiGuardrailViolationError";
    this.violations = violations;
  }
}

const PROHIBITED_KEYWORDS_PATTERNS: Array<{ regex: RegExp; code: string; reason: string }> = [
  // 1. Medical clearance mutations / clinical decisions
  {
    regex: /(?:change|grant|clear|override|bypass|approve)\s+(?:medical\s+)?clearance/i,
    code: "PROHIBITED_MEDICAL_CLEARANCE_MUTATION",
    reason: "AI cannot change, grant, or bypass medical clearance.",
  },
  {
    regex: /(?:diagnose|prescribe|clinical\s+diagnosis|medical\s+treatment\s+plan)/i,
    code: "PROHIBITED_CLINICAL_DECISION",
    reason: "AI cannot make clinical diagnoses or decisions.",
  },
  // 2. Consent bypass or mutation
  {
    regex: /(?:ignore|bypass|waive|override|modify|sign)\s+consent/i,
    code: "PROHIBITED_CONSENT_MUTATION",
    reason: "AI cannot ignore, waive, or modify consent.",
  },
  // 3. Procedure start / complete / abort
  {
    regex: /(?:auto[-_\s]?start|start|complete|abort|finish)\s+(?:the\s+)?procedure/i,
    code: "PROHIBITED_PROCEDURE_MUTATION",
    reason: "AI cannot autonomously start, complete, or abort procedures.",
  },
  // 4. Financial mutations / refunds / ledger adjustments
  {
    regex: /(?:refund|issue\s+refund|create\s+payment|edit\s+ledger|alter\s+ledger|adjust\s+balance|payout)/i,
    code: "PROHIBITED_FINANCIAL_MUTATION",
    reason: "AI cannot refund payments or alter ledger entries.",
  },
  // 5. Automatic external message sending
  {
    regex: /(?:auto[-_\s]?send|automatically\s+send|send\s+whatsapp\s+direct|deliver\s+without\s+review)/i,
    code: "PROHIBITED_AUTO_MESSAGE_SEND",
    reason: "AI cannot autonomously send external messages without human review.",
  },
  // 6. Google account connect / disconnect
  {
    regex: /(?:connect|disconnect|reconnect)\s+google(?:\s+account|\s+calendar)?/i,
    code: "PROHIBITED_GOOGLE_CONNECTION_MUTATION",
    reason: "AI cannot connect or disconnect Google integrations.",
  },
  // 7. Bypassing appointment availability / autonomous booking
  {
    regex: /(?:bypass\s+availability|force\s+book|book\s+autonomously|auto[-_\s]?book)/i,
    code: "PROHIBITED_APPOINTMENT_MUTATION",
    reason: "AI cannot book or cancel appointments without human staff action.",
  },
  // 8. Direct TreatmentCycle stage changing
  {
    regex: /(?:change|advance|transition|set)\s+(?:treatment\s+)?cycle\s+stage\s+directly/i,
    code: "PROHIBITED_CYCLE_STAGE_MUTATION",
    reason: "AI cannot directly change TreatmentCycle stage.",
  },
];

export function checkActionProhibitions(
  action: SuggestedActionInput
): GuardrailViolation | null {
  const normalizedActionType = (action.actionType || "").toUpperCase();

  // 1. Explicit prohibited autonomous action enum
  if ((PROHIBITED_AUTONOMOUS_ACTIONS as readonly string[]).includes(normalizedActionType)) {
    return {
      code: "PROHIBITED_AUTONOMOUS_ACTION_TYPE",
      message: `Action type '${action.actionType}' is prohibited for AI copilot.`,
      actionId: action.id,
      prohibitedPattern: action.actionType,
    };
  }

  // 2. Keyword & pattern inspection across label and description
  const combinedText = `${action.label} ${action.description} ${action.actionType}`;
  for (const pattern of PROHIBITED_KEYWORDS_PATTERNS) {
    if (pattern.regex.test(combinedText)) {
      return {
        code: pattern.code,
        message: pattern.reason,
        actionId: action.id,
        prohibitedPattern: pattern.regex.source,
      };
    }
  }

  return null;
}

export function guardSuggestedActions(
  actions: SuggestedActionInput[],
  context: GuardrailContext = {}
): {
  guardedActions: SuggestedAction[];
  violations: GuardrailViolation[];
} {
  const violations: GuardrailViolation[] = [];
  const guardedActions: SuggestedAction[] = [];

  for (const action of actions) {
    const violation = checkActionProhibitions(action);
    const actionId = action.id || `act-${Math.random().toString(36).substring(2, 9)}`;
    if (violation) {
      violations.push(violation);
      // Mark action as prohibited with explanation, do not execute
      guardedActions.push({
        id: actionId,
        label: action.label,
        actionType: action.actionType,
        description: action.description,
        targetEntity: action.targetEntity,
        targetId: action.targetId,
        isProhibited: true,
        blockedReason: violation.message,
      });
      continue;
    }

    // Contextual deterministic blocker checks:
    // If medical clearance requires review or is ineligible, block procedure-related suggestions
    if (
      context.medicalClearanceStatus === "REVIEW_REQUIRED" ||
      context.medicalClearanceStatus === "INELIGIBLE" ||
      context.hasMedicalReviewRequired
    ) {
      const lowerText = `${action.label} ${action.description}`.toLowerCase();
      if (
        lowerText.includes("procedure") ||
        lowerText.includes("treatment") ||
        lowerText.includes("session")
      ) {
        guardedActions.push({
          id: actionId,
          label: "Review Medical Profile",
          actionType: "REVIEW_MEDICAL_PROFILE",
          description:
            "Medical clearance requires review before proceeding with procedures.",
          isProhibited: false,
          blockedReason: "Deterministic medical review blocker active.",
        });
        continue;
      }
    }

    // Ensure actionType is an allowed advisory type
    let safeActionType: AllowedAdvisoryActionType = "VIEW_CLIENT";
    if (
      (ALLOWED_ADVISORY_ACTION_TYPES as readonly string[]).includes(
        action.actionType as any
      )
    ) {
      safeActionType = action.actionType as AllowedAdvisoryActionType;
    }

    guardedActions.push({
      id: actionId,
      label: action.label,
      actionType: safeActionType,
      description: action.description,
      targetEntity: action.targetEntity,
      targetId: action.targetId,
      isProhibited: false,
    });
  }

  return {
    guardedActions,
    violations,
  };
}

export function enforceStrictGuardrails(
  actions: SuggestedActionInput[],
  context: GuardrailContext = {}
): SuggestedAction[] {
  const { guardedActions, violations } = guardSuggestedActions(actions, context);
  if (violations.length > 0) {
    // If any strictly prohibited action was generated, throw error or filter out prohibited actions
    const strictlyProhibited = violations.filter(
      (v) =>
        v.code.startsWith("PROHIBITED_")
    );
    if (strictlyProhibited.length > 0) {
      throw new AiGuardrailViolationError(
        `AI generated ${strictlyProhibited.length} prohibited action(s): ${strictlyProhibited.map((v) => v.message).join("; ")}`,
        strictlyProhibited
      );
    }
  }
  return guardedActions;
}

export function sanitizeReplyDraft(
  draftReply: string
): { isSafe: boolean; sanitizedReply: string; warnings: string[] } {
  const warnings: string[] = [];
  
  // Check if draft contains fraudulent promises like "I have already refunded your account"
  const autoRefundClaim = /(?:i have|we have)\s+(?:already\s+)?refunded/i;
  if (autoRefundClaim.test(draftReply)) {
    warnings.push("Draft contained autonomous refund claim; human verification required.");
  }

  const autoClearedClaim = /(?:i have|we have)\s+(?:marked|approved)\s+your\s+medical\s+clearance/i;
  if (autoClearedClaim.test(draftReply)) {
    warnings.push("Draft contained autonomous medical approval claim.");
  }

  return {
    isSafe: warnings.length === 0,
    sanitizedReply: draftReply,
    warnings,
  };
}
