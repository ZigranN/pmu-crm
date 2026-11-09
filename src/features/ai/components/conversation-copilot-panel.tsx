"use client";

import { useState } from "react";
import { Sparkles, MessageSquare, AlertCircle, Check } from "lucide-react";
import {
  generateConversationSummaryAction,
  generateReplyDraftAction,
} from "../server/actions";
import type {
  ConversationSummaryOutput,
  ReplyDraftOutput,
} from "../schemas/ai.schema";

interface ConversationCopilotPanelProps {
  conversationId: string;
  onApplyDraft?: (draft: string) => void;
}

export function ConversationCopilotPanel({
  conversationId,
  onApplyDraft,
}: ConversationCopilotPanelProps) {
  const [summary, setSummary] = useState<ConversationSummaryOutput | null>(null);
  const [draft, setDraft] = useState<ReplyDraftOutput | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedDraft, setCopiedDraft] = useState(false);

  const handleSummarize = async () => {
    setLoadingSummary(true);
    setError(null);
    try {
      const res = await generateConversationSummaryAction({
        conversationId,
        requestKey: `conv-sum-${conversationId}-${Date.now()}`,
      });
      setSummary(res);
    } catch (err: any) {
      setError(err?.message || "Failed to generate conversation summary.");
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleDraftReply = async (tone: "professional" | "empathetic" | "concise" = "professional") => {
    setLoadingDraft(true);
    setError(null);
    try {
      const res = await generateReplyDraftAction({
        conversationId,
        tone,
        requestKey: `conv-draft-${conversationId}-${Date.now()}`,
      });
      setDraft(res);
    } catch (err: any) {
      setError(err?.message || "Failed to draft reply.");
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleUseDraft = () => {
    if (draft?.draftReply && onApplyDraft) {
      onApplyDraft(draft.draftReply);
      setCopiedDraft(true);
      setTimeout(() => setCopiedDraft(false), 2000);
    }
  };

  return (
    <div className="rounded-md border border-purple-200 bg-purple-50/30 p-3 text-xs dark:border-purple-900/40 dark:bg-purple-950/20">
      <div className="flex items-center justify-between pb-2 border-b border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center gap-1.5 font-medium text-purple-950 dark:text-purple-200">
          <Sparkles className="h-4 w-4 text-purple-600" />
          <span>Conversation Copilot</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-300">
            Advisory Drafts
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSummarize}
            disabled={loadingSummary}
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-800 hover:bg-purple-50 text-purple-900 dark:text-purple-200 transition-colors"
          >
            {loadingSummary ? "Summarizing..." : "Summarize"}
          </button>
          <button
            onClick={() => handleDraftReply("professional")}
            disabled={loadingDraft}
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            {loadingDraft ? "Drafting..." : "Draft Reply"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 p-2 rounded bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-[11px] flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="mt-2.5 p-2 rounded bg-white dark:bg-gray-900 border border-purple-100 dark:border-purple-900/30 space-y-1.5">
          <p className="font-semibold text-gray-900 dark:text-gray-100">Summary:</p>
          <p className="text-gray-700 dark:text-gray-300">{summary.summary}</p>
          {summary.latestClientIntent && (
            <p className="text-[11px] text-purple-700 dark:text-purple-300">
              <span className="font-medium">Client Intent:</span> {summary.latestClientIntent}
            </p>
          )}
          {summary.openQuestions && summary.openQuestions.length > 0 && (
            <div className="text-[11px] text-amber-800 dark:text-amber-300">
              <span className="font-medium">Open Questions:</span> {summary.openQuestions.join("; ")}
            </div>
          )}
        </div>
      )}

      {draft && (
        <div className="mt-2.5 p-2 rounded bg-white dark:bg-gray-900 border border-purple-100 dark:border-purple-900/30 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              AI Proposed Draft (Review &amp; Edit before sending):
            </span>
            {onApplyDraft && (
              <button
                onClick={handleUseDraft}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 hover:bg-purple-200"
              >
                {copiedDraft ? <Check className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                {copiedDraft ? "Inserted" : "Insert into Editor"}
              </button>
            )}
          </div>
          <p className="text-gray-800 dark:text-gray-200 italic p-1.5 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-100 dark:border-gray-800">
            &ldquo;{draft.draftReply}&rdquo;
          </p>
          <p className="text-[10px] text-gray-500">
            Tone: {draft.tone} • Rationale: {draft.rationale}
          </p>
        </div>
      )}
    </div>
  );
}
