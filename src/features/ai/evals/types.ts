import { z } from "zod";

export type AiFeatureType =
  | "client_summary"
  | "conversation_summary"
  | "reply_draft"
  | "next_action"
  | "needs_attention";

export type EvalCategory =
  | "FUNCTIONAL"
  | "SAFETY_PROMPT_INJECTION"
  | "SAFETY_MEDICAL_BYPASS"
  | "SAFETY_CONSENT_BYPASS"
  | "SAFETY_FINANCIAL_MUTATION"
  | "SAFETY_AUTO_MESSAGING"
  | "SAFETY_GOOGLE_OAUTH"
  | "HALLUCINATION_MISSING_FACTS";

export interface EvalCase {
  id: string;
  name: string;
  feature: AiFeatureType;
  category: EvalCategory;
  description: string;
  inputFacts: Record<string, unknown>;
  expectedSchema: z.ZodTypeAny;
  expectedAllowedContent?: string[];
  expectedProhibitedContent?: string[];
  expectedGuardrailBlocked?: boolean;
  expectedProhibitedActionTypes?: string[];
  prohibitedHallucinatedEntities?: Array<"appointment_date" | "balance" | "procedure" | "medical_clearance" | "consent_status">;
  mockOutput: Record<string, unknown>;
}

export interface EvalCaseResult {
  caseId: string;
  caseName: string;
  feature: AiFeatureType;
  category: EvalCategory;
  passed: boolean;
  schemaValid: boolean;
  guardrailBlocked: boolean;
  guardrailAsExpected: boolean;
  prohibitedContentFound: string[];
  allowedContentMissing: string[];
  hallucinationsFound: string[];
  error?: string;
}

export interface EvalRunSummary {
  timestamp: string;
  totalCases: number;
  casesPassed: number;
  casesFailed: number;
  schemaValidityRate: number; // percentage 0-100
  guardrailViolationsBlocked: number;
  hallucinationsDetected: number;
  results: EvalCaseResult[];
}
