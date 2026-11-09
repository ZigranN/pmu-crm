"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Send,
  ExternalLink,
  CheckCircle2,
  Lock,
  Unlock,
  Clock,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConversationMessageRecord, MessageChannel } from "../domain/types";
import { ConversationCopilotPanel } from "@/features/ai/components/conversation-copilot-panel";

interface StaffMember {
  id: string;
  name: string;
}

interface ConversationDetailProps {
  conversation: {
    id: string;
    clientId: string;
    client: {
      id: string;
      fullName: string | null;
      firstName: string | null;
      phone: string | null;
    };
    cycle?: {
      id: string;
      zoneCode: string;
    } | null;
    assignedUser?: {
      id: string;
      name: string | null;
    } | null;
    assignedUserId: string | null;
    status: "OPEN" | "CLOSED";
    unreadCount: number;
  };
  messages: ConversationMessageRecord[];
  staffMembers: StaffMember[];
  onSendMessage: (body: string) => Promise<void>;
  onMarkRead: () => Promise<void>;
  onAssign: (userId: string | null) => Promise<void>;
  onToggleStatus: () => Promise<void>;
  isSending?: boolean;
}

export function ConversationDetail({
  conversation,
  messages,
  staffMembers,
  onSendMessage,
  onMarkRead,
  onAssign,
  onToggleStatus,
  isSending = false,
}: ConversationDetailProps) {
  const [messageText, setMessageText] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || isSending) return;
    const text = messageText;
    setMessageText("");
    await onSendMessage(text);
  };

  const getChannelBadge = (channel: MessageChannel) => {
    switch (channel) {
      case "WHATSAPP":
        return <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 text-[10px] px-1.5 py-0">WhatsApp</Badge>;
      case "SMS":
        return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50 text-[10px] px-1.5 py-0">SMS</Badge>;
      case "EMAIL":
        return <Badge variant="outline" className="text-purple-600 border-purple-300 bg-purple-50 text-[10px] px-1.5 py-0">Email</Badge>;
      case "MANUAL":
      default:
        return <Badge variant="outline" className="text-muted-foreground border-border text-[10px] px-1.5 py-0">Вручную</Badge>;
    }
  };

  const clientName = conversation.client.fullName || conversation.client.firstName || "Клиент";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top Header */}
      <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3 bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-10 w-10 border">
            <AvatarFallback className="font-semibold text-sm bg-primary/10 text-primary">
              {clientName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold truncate text-foreground">{clientName}</h2>
              <Link
                href={`/clients/${conversation.clientId}`}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
                title="Перейти в карточку клиента"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              {conversation.client.phone && <span>{conversation.client.phone}</span>}
              {conversation.cycle && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                  Цикл: {conversation.cycle.zoneCode}
                </Badge>
              )}
              {conversation.status === "CLOSED" ? (
                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-[10px] px-1.5 py-0 flex items-center gap-1">
                  <Lock className="h-2.5 w-2.5" />
                  Закрыт
                </Badge>
              ) : (
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 text-[10px] px-1.5 py-0 flex items-center gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Открыт
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Staff Assignment */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground hidden sm:inline">Ответственный:</span>
            <Select
              value={conversation.assignedUserId ?? "unassigned"}
              onValueChange={(val) => onAssign(val === "unassigned" ? null : val)}
            >
              <SelectTrigger className="h-8 text-xs w-[140px]">
                <SelectValue placeholder="Не назначен" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Не назначен</SelectItem>
                {staffMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id} className="text-xs">
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mark read button */}
          {conversation.unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onMarkRead}
              className="h-8 text-xs"
              title="Отметить прочитанным"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Прочитано
            </Button>
          )}

          {/* Close / Reopen */}
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleStatus}
            className="h-8 text-xs"
          >
            {conversation.status === "OPEN" ? (
              <>
                <Lock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                Закрыть
              </>
            ) : (
              <>
                <Unlock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                Открыть
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Manual message mode banner (Section 23) */}
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span>
          Режим ручной записи: сообщения сохраняются во внутренней хронологии CRM без внешней отправки через провайдеров.
        </span>
      </div>

      {/* Message Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-8">
            <Clock className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-sm font-medium">История сообщений пуста</p>
            <p className="text-xs mt-1 text-muted-foreground/80 max-w-sm">
              Запишите первое сообщение или заметку вручную для сохранения хронологии взаимодействия с клиентом.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOutbound = msg.direction === "OUTBOUND";

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 shadow-xs space-y-1 ${
                    isOutbound
                      ? "bg-primary/10 text-foreground border border-primary/20 rounded-br-xs"
                      : "bg-card text-card-foreground border rounded-bl-xs"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80">
                      {isOutbound ? (msg.senderName || "Сотрудник") : clientName}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {getChannelBadge(msg.channel)}
                      <span>
                        {format(new Date(msg.sentAt), "d MMM, HH:mm", { locale: ru })}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed text-foreground">
                    {msg.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Area */}
      <div className="p-3 border-t bg-background space-y-3">
        <ConversationCopilotPanel
          conversationId={conversation.id}
          onApplyDraft={(draftText) => setMessageText(draftText)}
        />

        <form onSubmit={handleSend} className="space-y-2">
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Введите текст сообщения или ручную заметку..."
            className="min-h-[80px] max-h-[160px] text-sm resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Ctrl+Enter для быстрой отправки
            </span>

            <Button
              type="submit"
              size="sm"
              disabled={!messageText.trim() || isSending}
              className="gap-1.5"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSending ? "Запись..." : "Записать сообщение"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
