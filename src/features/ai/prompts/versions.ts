export const PROMPT_VERSIONS = {
  CLIENT_SUMMARY: "client_summary.v1",
  CONVERSATION_SUMMARY: "conversation_summary.v1",
  REPLY_DRAFT: "reply_draft.v1",
  NEXT_ACTION_SUGGESTION: "next_action_suggestion.v1",
  NEEDS_ATTENTION_EXPLAIN: "needs_attention_explain.v1",
} as const;

export type PromptVersionKey = keyof typeof PROMPT_VERSIONS;
export type PromptVersion = (typeof PROMPT_VERSIONS)[PromptVersionKey];
