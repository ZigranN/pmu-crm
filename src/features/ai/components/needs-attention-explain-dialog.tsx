"use client";

import { useState } from "react";
import { Sparkles, AlertCircle, X, ArrowRight } from "lucide-react";
import { explainNeedsAttentionAction } from "../server/actions";
import type { NeedsAttentionExplainOutput } from "../schemas/ai.schema";

interface NeedsAttentionExplainDialogProps {
  itemId: string;
  reasonTitle: string;
  reasonCode: string;
  severity: string;
}

export function NeedsAttentionExplainDialog({
  itemId,
  reasonTitle,
  reasonCode,
  severity,
}: NeedsAttentionExplainDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<NeedsAttentionExplainOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenAndExplain = async () => {
    setOpen(true);
    if (!explanation) {
      setLoading(true);
      setError(null);
      try {
        const res = await explainNeedsAttentionAction({
          itemId: `${itemId}:${reasonCode}`,
          requestKey: `explain-${itemId}-${Date.now()}`,
        });
        setExplanation(res);
      } catch (err: any) {
        setError(err?.message || "Failed to generate explanation.");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <button
        onClick={handleOpenAndExplain}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-300 hover:text-purple-900 underline"
        title="Explain with AI"
      >
        <Sparkles className="h-3 w-3" />
        AI Explainer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900 border border-purple-200 dark:border-purple-800 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5 font-semibold text-purple-950 dark:text-purple-200">
                <Sparkles className="h-4 w-4 text-purple-600" />
                <span>AI Operational Explainer</span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="p-2 rounded bg-gray-50 dark:bg-gray-800">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{reasonTitle}</p>
                <p className="text-[11px] text-gray-500">
                  Code: {reasonCode} • Severity: {severity} (Deterministic Rule)
                </p>
              </div>

              {loading && (
                <div className="py-6 text-center text-muted-foreground animate-pulse">
                  Analyzing deterministic triggers and operational dependencies...
                </div>
              )}

              {error && (
                <div className="p-2.5 rounded bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {explanation && (
                <div className="space-y-2.5">
                  <div>
                    <p className="font-medium text-gray-700 dark:text-gray-300">Why this was flagged:</p>
                    <p className="text-gray-800 dark:text-gray-200 mt-0.5 leading-relaxed">
                      {explanation.explanation}
                    </p>
                  </div>

                  {explanation.recommendedHumanNextSteps &&
                    explanation.recommendedHumanNextSteps.length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Recommended Human Next Steps:
                        </p>
                        <ul className="space-y-1">
                          {explanation.recommendedHumanNextSteps.map((step, idx) => (
                            <li
                              key={idx}
                              className="p-1.5 rounded bg-purple-50/60 dark:bg-purple-950/30 text-purple-950 dark:text-purple-200 flex items-center gap-1.5"
                            >
                              <ArrowRight className="h-3 w-3 text-purple-600 shrink-0" />
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
