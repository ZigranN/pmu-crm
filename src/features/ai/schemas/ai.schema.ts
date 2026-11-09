import { z } from "zod";

export const ALLOWED_ADVISORY_ACTION_TYPES = [
  "VIEW_CLIENT",
  "REVIEW_MEDICAL_PROFILE",
  "REQUEST_CONSENT",
  "OPEN_CONVERSATION",
  "SCHEDULE_APPOINTMENT_MANUAL",
  "COLLECT_DEPOSIT_MANUAL",
  "REVIEW_CYCLE_STAGE",
  "SEND_MESSAGE_DRAFT",
  "VIEW_PROCEDURE_HISTORY",
  "VIEW_ATTENTION_ITEM",
] as const;

export type AllowedAdvisoryActionType = typeof ALLOWED_ADVISORY_ACTION_TYPES[number];

export const PROHIBITED_AUTONOMOUS_ACTIONS = [
  "CHANGE_STAGE",
  "ADVANCE_CYCLE",
  "CHANGE_MEDICAL_CLEARANCE",
  "CLEAR_MEDICAL",
  "OVERRIDE_MEDICAL",
  "BYPASS_CONSENT",
  "MODIFY_CONSENT",
  "SIGN_CONSENT",
  "START_PROCEDURE",
  "COMPLETE_PROCEDURE",
  "ABORT_PROCEDURE",
  "CREATE_PAYMENT",
  "REFUND_PAYMENT",
  "EDIT_LEDGER",
  "ADJUST_BALANCE",
  "AUTO_SEND_MESSAGE",
  "SEND_WHATSAPP_AUTONOMOUS",
  "CONNECT_GOOGLE",
  "DISCONNECT_GOOGLE",
  "BOOK_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "CLINICAL_DIAGNOSIS",
  "PRESCRIBE",
] as const;

export type ProhibitedAutonomousAction = typeof PROHIBITED_AUTONOMOUS_ACTIONS[number];

export const SuggestedActionSchema = z.object({
  id: z.string().default(() => `act-${Math.random().toString(36).substring(2, 9)}`),
  label: z.string().min(1),
  actionType: z.enum(ALLOWED_ADVISORY_ACTION_TYPES).or(z.string()),
  description: z.string().min(1),
  targetEntity: z.string().optional(),
  targetId: z.string().optional(),
  isProhibited: z.boolean().default(false),
  blockedReason: z.string().optional(),
});

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type SuggestedActionInput = z.input<typeof SuggestedActionSchema>;

// 1. Client Summary Output
export const ClientSummaryOutputSchema = z.object({
  summary: z.string().min(1),
  blockers: z.array(z.string()).default([]),
  suggestedActions: z.array(SuggestedActionSchema).default([]),
  dataConfidence: z.enum(["high", "medium", "low"]).default("high"),
  sourceCitations: z.array(z.string()).optional().default([]),
});

export type ClientSummaryOutput = z.infer<typeof ClientSummaryOutputSchema>;

// 2. Conversation Summary Output
export const ConversationSummaryOutputSchema = z.object({
  summary: z.string().min(1),
  openQuestions: z.array(z.string()).default([]),
  latestClientIntent: z.string().min(1),
  unansweredItems: z.array(z.string()).default([]),
  referencedMessageIds: z.array(z.string()).optional().default([]),
});

export type ConversationSummaryOutput = z.infer<typeof ConversationSummaryOutputSchema>;

// 3. Reply Draft Output
export const ReplyDraftOutputSchema = z.object({
  draftReply: z.string().min(1),
  tone: z.enum(["professional", "empathetic", "concise"]).default("professional"),
  rationale: z.string().min(1),
  suggestedFollowUpAction: z.string().optional(),
});

export type ReplyDraftOutput = z.infer<typeof ReplyDraftOutputSchema>;

// 4. Next Action Suggestions Output
export const NextActionSuggestionsOutputSchema = z.object({
  suggestedActions: z.array(SuggestedActionSchema).default([]),
  blockers: z.array(z.string()).default([]),
  rationale: z.string().min(1),
});

export type NextActionSuggestionsOutput = z.infer<typeof NextActionSuggestionsOutputSchema>;

// 5. Needs Attention Explain Output
export const NeedsAttentionExplainOutputSchema = z.object({
  explanation: z.string().min(1),
  deterministicReasonSummary: z.string().min(1),
  recommendedHumanNextSteps: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
});

export type NeedsAttentionExplainOutput = z.infer<typeof NeedsAttentionExplainOutputSchema>;

// Inputs for Server Actions
export const GenerateClientSummaryInputSchema = z.object({
  clientId: z.string().uuid(),
  requestKey: z.string().optional(),
});
export type GenerateClientSummaryInput = z.infer<typeof GenerateClientSummaryInputSchema>;

export const GenerateConversationSummaryInputSchema = z.object({
  conversationId: z.string().uuid(),
  requestKey: z.string().optional(),
});
export type GenerateConversationSummaryInput = z.infer<typeof GenerateConversationSummaryInputSchema>;

export const GenerateReplyDraftInputSchema = z.object({
  conversationId: z.string().uuid(),
  tone: z.enum(["professional", "empathetic", "concise"]).optional(),
  requestKey: z.string().optional(),
});
export type GenerateReplyDraftInput = z.infer<typeof GenerateReplyDraftInputSchema>;

export const GenerateNextActionSuggestionsInputSchema = z.object({
  clientId: z.string().uuid(),
  cycleId: z.string().uuid().optional().nullable(),
  requestKey: z.string().optional(),
});
export type GenerateNextActionSuggestionsInput = z.infer<typeof GenerateNextActionSuggestionsInputSchema>;

export const ExplainNeedsAttentionInputSchema = z.object({
  itemId: z.string(),
  requestKey: z.string().optional(),
});
export type ExplainNeedsAttentionInput = z.infer<typeof ExplainNeedsAttentionInputSchema>;
