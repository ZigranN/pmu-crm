"use client";

import { useState } from "react";
import { Sparkles, AlertCircle, RefreshCw, CheckCircle2, ShieldAlert } from "lucide-react";
import { generateClientSummaryAction } from "../server/actions";
import type { ClientSummaryOutput } from "../schemas/ai.schema";

interface ClientAiSummaryCardProps {
  clientId: string;
  initialSummary?: ClientSummaryOutput | null;
  initialGeneratedAt?: string | null;
}

export function ClientAiSummaryCard({
  clientId,
  initialSummary,
  initialGeneratedAt,
}: ClientAiSummaryCardProps) {
  const [summary, setSummary] = useState<ClientSummaryOutput | null>(initialSummary || null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateClientSummaryAction({
        clientId,
        requestKey: `summary-${clientId}-${Date.now()}`,
      });
      setSummary(res);
      setGeneratedAt(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err?.message || "AI copilot currently unavailable.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-4 shadow-sm dark:border-purple-900/50 dark:bg-purple-950/20">
      <div className="flex items-center justify-between pb-3 border-b border-purple-100 dark:border-purple-900/40">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          <h3 className="font-semibold text-sm text-purple-950 dark:text-purple-200">
            AI Client Copilot
          </h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300">
            AI-generated (Advisory Only)
          </span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          {summary ? "Regenerate" : "Generate Summary"}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 text-xs flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">AI Service Notification</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading && !summary && (
        <div className="py-6 text-center text-xs text-muted-foreground animate-pulse">
          Analyzing client timeline, treatment cycles, and operational history...
        </div>
      )}

      {summary && (
        <div className="mt-3 space-y-3 text-xs">
          <div>
            <p className="text-gray-800 dark:text-gray-200 leading-relaxed font-normal">
              {summary.summary}
            </p>
            {generatedAt && (
              <p className="text-[10px] text-gray-500 mt-1">
                Last generated at {generatedAt} • Confidence: {summary.dataConfidence}
              </p>
            )}
          </div>

          {summary.blockers && summary.blockers.length > 0 && (
            <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
              <p className="font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                Active Blockers
              </p>
              <ul className="mt-1 space-y-0.5 list-disc list-inside text-amber-800 dark:text-amber-300">
                {summary.blockers.map((blocker, idx) => (
                  <li key={idx}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.suggestedActions && summary.suggestedActions.length > 0 && (
            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-purple-600" />
                Suggested Next Actions (Human Approval Required)
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {summary.suggestedActions.map((act) => (
                  <div
                    key={act.id}
                    className="p-2 rounded border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-xs flex flex-col justify-between"
                  >
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">
                        {act.label}
                      </p>
                      <p className="text-gray-600 dark:text-gray-400 mt-0.5">
                        {act.description}
                      </p>
                    </div>
                    {act.blockedReason && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                        Note: {act.blockedReason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !summary && !error && (
        <div className="py-4 text-center text-xs text-muted-foreground">
          Click &ldquo;Generate Summary&rdquo; to analyze this client with AI copilot.
        </div>
      )}
    </div>
  );
}
