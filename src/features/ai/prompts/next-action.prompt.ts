import { PROMPT_VERSIONS } from "./versions";

export interface NextActionPromptInput {
  clientName: string;
  stage?: string;
  medicalEligibility: "ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE" | "UNKNOWN";
  consentStatus: "SIGNED" | "PENDING" | "EXPIRED" | "NOT_REQUIRED";
  hasUpcomingAppointment: boolean;
  upcomingAppointmentDate?: string;
  needsAttentionReasons: string[];
  unreadInboundMessagesCount: number;
  balanceCents: number;
}

export function buildNextActionPrompt(input: NextActionPromptInput): {
  systemPrompt: string;
  prompt: string;
  promptVersion: string;
} {
  const systemPrompt = `You are an operational copilot for PMU and beauty studio workflow coordination.
Your goal is to suggest logical next operational steps for staff to consider.

CRITICAL DETERMINISTIC GOVERNANCE RULES:
1. Deterministic blockers outrank AI recommendations.
2. If medicalEligibility is "REVIEW_REQUIRED" or "INELIGIBLE", you CANNOT recommend starting a procedure or scheduling without clearance. You MUST recommend reviewing medical profile.
3. If consentStatus is "PENDING" or "EXPIRED", you CANNOT recommend starting a procedure without consent. You MUST recommend obtaining consent.
4. You CANNOT suggest autonomous mutations (no direct stage changing, no direct ledger updates, no auto-messages).
5. Allowed action types: VIEW_CLIENT, REVIEW_MEDICAL_PROFILE, REQUEST_CONSENT, OPEN_CONVERSATION, SCHEDULE_APPOINTMENT_MANUAL, COLLECT_DEPOSIT_MANUAL, REVIEW_CYCLE_STAGE.

Output valid JSON matching schema:
{
  "suggestedActions": [
    {
      "id": string,
      "label": string,
      "actionType": "VIEW_CLIENT" | "REVIEW_MEDICAL_PROFILE" | "REQUEST_CONSENT" | "OPEN_CONVERSATION" | "SCHEDULE_APPOINTMENT_MANUAL" | "COLLECT_DEPOSIT_MANUAL" | "REVIEW_CYCLE_STAGE",
      "description": string
    }
  ],
  "blockers": string[],
  "rationale": string
}`;

  const prompt = `<OPERATIONAL_STATE>
Client: ${input.clientName}
Cycle Stage: ${input.stage || "None active"}
Medical Eligibility: ${input.medicalEligibility}
Consent Status: ${input.consentStatus}
Upcoming Appointment: ${input.hasUpcomingAppointment ? input.upcomingAppointmentDate : "None"}
Needs Attention Reasons: ${input.needsAttentionReasons.join("; ") || "None"}
Unread Inbound Messages: ${input.unreadInboundMessagesCount}
Outstanding Balance: $${(input.balanceCents / 100).toFixed(2)}
</OPERATIONAL_STATE>

Suggest prioritised next actions for staff.`;

  return {
    systemPrompt,
    prompt,
    promptVersion: PROMPT_VERSIONS.NEXT_ACTION_SUGGESTION,
  };
}
