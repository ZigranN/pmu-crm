"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { NeedsAttentionItem } from "../domain/types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  ExternalLink,
  User,
  UserCheck,
} from "lucide-react";
import { NeedsAttentionExplainDialog } from "@/features/ai/components/needs-attention-explain-dialog";

interface AttentionItemCardProps {
  item: NeedsAttentionItem;
}

export function AttentionItemCard({ item }: AttentionItemCardProps) {
  const severityConfig = {
    CRITICAL: {
      badgeBg: "bg-destructive/15 text-destructive border-destructive/30",
      label: "Критично",
      icon: AlertCircle,
      borderColor: "border-l-destructive",
    },
    HIGH: {
      badgeBg: "bg-amber-500/15 text-amber-700 border-amber-500/30",
      label: "Высокий",
      icon: AlertTriangle,
      borderColor: "border-l-amber-500",
    },
    MEDIUM: {
      badgeBg: "bg-blue-500/15 text-blue-700 border-blue-500/30",
      label: "Средний",
      icon: Clock,
      borderColor: "border-l-blue-500",
    },
    LOW: {
      badgeBg: "bg-muted text-muted-foreground border-border",
      label: "Низкий",
      icon: Clock,
      borderColor: "border-l-muted-foreground",
    },
  }[item.severity];

  const SeverityIcon = severityConfig.icon;
  const isOverdue = Boolean(item.isOverdue);

  return (
    <Card
      className={`border-l-4 ${severityConfig.borderColor} bg-card hover:shadow-sm transition-all`}
    >
      <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-xs px-2 py-0.5 ${severityConfig.badgeBg}`}>
              <SeverityIcon className="w-3 h-3 mr-1 inline" />
              {severityConfig.label}
            </Badge>

            <span className="text-sm font-semibold text-foreground">{item.title}</span>

            {isOverdue && (
              <Badge variant="destructive" className="text-[11px] px-1.5 py-0">
                Просрочено
              </Badge>
            )}

            {item.ownershipState === "HANDOFF_PENDING" && (
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-500/40 text-amber-700 bg-amber-500/10">
                Передача: {item.pendingAssigneeName || "Ожидает"}
              </Badge>
            )}

            {item.ownershipState === "ACCEPTED" && (
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-green-500/40 text-green-700 bg-green-500/10">
                Ответственный: {item.assignedUserName || "Сотрудник"}
              </Badge>
            )}

            {item.ownershipState === "UNASSIGNED" && (
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-muted text-muted-foreground">
                Не назначен
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>

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
                  <span className="text-muted-foreground font-normal">({item.clientPhone})</span>
                )}
              </div>
            )}

            {item.masterName && (
              <div className="flex items-center gap-1">
                <UserCheck className="w-3 h-3 text-muted-foreground" />
                <span>Мастер: {item.masterName}</span>
              </div>
            )}

            {item.dueAt && (
              <div className="flex items-center gap-1 text-xs">
                <Calendar className="w-3 h-3 text-muted-foreground" />
                <span>
                  Срок: {new Date(item.dueAt).toLocaleDateString("ru-RU")}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
          <NeedsAttentionExplainDialog
            itemId={item.id}
            reasonTitle={item.title}
            reasonCode={item.reasonCode}
            severity={item.severity}
          />
          <Button asChild size="sm" variant="default" className="text-xs h-8">
            <Link href={item.actionUrl}>
              <span>{item.suggestedAction}</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
