"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryOutboxJob, retryAutomationExecution, reconcileGoogleCalendarConnection } from "../server/actions";

interface RetryJobButtonProps {
  id: string;
  type: "outbox" | "automation" | "google_calendar";
  label?: string;
}

export function RetryJobButton({ id, type, label = "Повторить" }: RetryJobButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRetry = () => {
    setError(null);
    startTransition(async () => {
      try {
        const reason = `Manual operator retry from Operations Dashboard (${type})`;
        if (type === "outbox") {
          await retryOutboxJob({ id, reason });
        } else if (type === "automation") {
          await retryAutomationExecution({ id, reason });
        } else if (type === "google_calendar") {
          await reconcileGoogleCalendarConnection({ id, reason });
        }
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка повторной попытки");
      }
    });
  };

  if (success) {
    return <span className="text-xs text-emerald-600 font-medium">Отправлено на повтор</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={isPending}
        className="text-xs h-7 px-2"
      >
        {isPending ? "Обработка..." : label}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
