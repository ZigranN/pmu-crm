"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { HandoffQueueItem } from "../domain/types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Sparkles,
  User,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";

interface HandoffCardProps {
  item: HandoffQueueItem;
  currentUserId?: string;
  onAccept: (id: string) => Promise<void>;
  onOpenReject: (item: HandoffQueueItem) => void;
  onComplete: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  isProcessing?: boolean;
}

export function HandoffCard({
  item,
  onAccept,
  onOpenReject,
  onComplete,
  onCancel,
  isProcessing = false,
}: HandoffCardProps) {
  const priorityConfig = {
    URGENT: {
      badgeBg: "bg-destructive/15 text-destructive border-destructive/30",
      label: "Срочный",
      icon: AlertCircle,
      borderColor: "border-l-destructive",
    },
    HIGH: {
      badgeBg: "bg-amber-500/15 text-amber-700 border-amber-500/30",
      label: "Высокий",
      icon: AlertTriangle,
      borderColor: "border-l-amber-500",
    },
    NORMAL: {
      badgeBg: "bg-blue-500/15 text-blue-700 border-blue-500/30",
      label: "Обычный",
      icon: Clock,
      borderColor: "border-l-blue-500",
    },
    LOW: {
      badgeBg: "bg-muted text-muted-foreground border-border",
      label: "Низкий",
      icon: Clock,
      borderColor: "border-l-muted-foreground",
    },
  }[item.priority];

  const statusConfig = {
    PENDING: {
      badgeBg: "bg-amber-500/10 text-amber-700 border-amber-500/30",
      label: "Ожидает принятия",
    },
    ACCEPTED: {
      badgeBg: "bg-green-500/10 text-green-700 border-green-500/30",
      label: "В работе",
    },
    REJECTED: {
      badgeBg: "bg-destructive/10 text-destructive border-destructive/30",
      label: "Отклонено",
    },
    CANCELLED: {
      badgeBg: "bg-muted text-muted-foreground border-border",
      label: "Отменено",
    },
    COMPLETED: {
      badgeBg: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
      label: "Выполнено",
    },
  }[item.status];

  const sourceConfig = {
    HUMAN: { label: "Сотрудник", icon: User },
    AUTOMATION: { label: "Автоматизация", icon: Bot },
    AI: { label: "AI Копилот", icon: Sparkles },
    SYSTEM: { label: "Система", icon: AlertCircle },
  }[item.sourceType];

  const PriorityIcon = priorityConfig.icon;
  const SourceIcon = sourceConfig.icon;

  const getContextUrl = () => {
    if (item.conversationId || item.entityType === "CONVERSATION") {
      return `/conversations`;
    }
    if (item.clientId || item.entityType === "CLIENT") {
      return `/clients/${item.clientId || item.entityId}`;
    }
    if (item.appointmentId || item.entityType === "APPOINTMENT") {
      return `/calendar`;
    }
    if (item.cycleId || item.entityType === "TREATMENT_CYCLE") {
      return item.clientId ? `/clients/${item.clientId}` : `/clients`;
    }
    return `/needs-attention`;
  };

  const isPending = item.status === "PENDING";
  const isAccepted = item.status === "ACCEPTED";

  return (
    <Card
      className={`border-l-4 ${priorityConfig.borderColor} bg-card hover:shadow-sm transition-all`}
    >
      <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs px-2 py-0.5 ${priorityConfig.badgeBg}`}
            >
              <PriorityIcon className="w-3 h-3 mr-1 inline" />
              {priorityConfig.label}
            </Badge>

            <Badge
              variant="outline"
              className={`text-xs px-2 py-0.5 ${statusConfig.badgeBg}`}
            >
              {statusConfig.label}
            </Badge>

            <Badge variant="outline" className="text-xs px-1.5 py-0.5 text-muted-foreground">
              <SourceIcon className="w-3 h-3 mr-1 inline" />
              {sourceConfig.label}
            </Badge>

            <span className="text-xs font-mono font-semibold text-foreground bg-muted/60 px-1.5 py-0.5 rounded">
              {item.reasonCode}
            </span>

            {item.isOverdue && (
              <Badge variant="destructive" className="text-[11px] px-1.5 py-0">
                Просрочено
              </Badge>
            )}
          </div>

          {item.reasonText && (
            <p className="text-xs text-foreground leading-relaxed">
              {item.reasonText}
            </p>
          )}

          {item.rejectionReason && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
              <span className="font-semibold">Причина отклонения:</span> {item.rejectionReason}
            </div>
          )}

          {item.cancellationReason && (
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
              <span className="font-semibold">Причина отмены:</span> {item.cancellationReason}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
            {item.clientName && (
              <div className="flex items-center gap-1 font-medium text-foreground">
                <User className="w-3 h-3 text-muted-foreground" />
                <Link
                  href={`/clients/${item.clientId}`}
                  className="hover:underline flex items-center gap-0.5"
                >
                  {item.clientName}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </Link>
                {item.clientPhone && (
                  <span className="text-muted-foreground font-normal">
                    ({item.clientPhone})
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-1">
              <UserCheck className="w-3 h-3 text-muted-foreground" />
              <span>
                Кому: <strong className="text-foreground">{item.toUserName || item.toUserId}</strong>
              </span>
            </div>

            {item.fromUserName && (
              <div className="flex items-center gap-1">
                <span>От кого: {item.fromUserName}</span>
              </div>
            )}

            {item.dueAt && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3 text-muted-foreground" />
                <span>
                  Срок: {new Date(item.dueAt).toLocaleDateString("ru-RU")}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1 text-[11px] opacity-75">
              <span>
                Создано: {new Date(item.createdAt).toLocaleDateString("ru-RU")} {new Date(item.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-center">
          <Button asChild size="sm" variant="outline" className="text-xs h-8">
            <Link href={getContextUrl()}>
              <span>Открыть объект</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </Button>

          {isPending && (
            <>
              <Button
                size="sm"
                variant="default"
                className="text-xs h-8 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onAccept(item.id)}
                disabled={isProcessing}
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                Принять
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 text-destructive hover:bg-destructive/10"
                onClick={() => onOpenReject(item)}
                disabled={isProcessing}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Отклонить
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-8 text-muted-foreground hover:bg-muted"
                onClick={() => onCancel(item.id)}
                disabled={isProcessing}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                Отменить
              </Button>
            </>
          )}

          {isAccepted && (
            <Button
              size="sm"
              variant="default"
              className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => onComplete(item.id)}
              disabled={isProcessing}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              Завершить
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
