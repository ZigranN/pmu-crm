"use client";

import * as React from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { MessageSquare, Send, ExternalLink, Info, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { sendManualMessageAction } from "../server/actions";
import type { ConversationMessageRecord, MessageChannel } from "../domain/types";

interface ClientConversationsTabProps {
  clientId: string;
  clientName: string;
  initialMessages: ConversationMessageRecord[];
  conversationId?: string | null;
}

export function ClientConversationsTab({
  clientId,
  clientName,
  initialMessages,
  conversationId,
}: ClientConversationsTabProps) {
  const [messages, setMessages] = React.useState<ConversationMessageRecord[]>(initialMessages);
  const [text, setText] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending) return;

    setIsSending(true);
    try {
      const res = await sendManualMessageAction({
        clientId,
        conversationId: conversationId ?? undefined,
        body: text.trim(),
      });

      setMessages((prev) => [...prev, { ...res.message, senderName: "Вы" }]);
      setText("");
      toast.success("Сообщение записано");
    } catch (err: any) {
      toast.error("Ошибка записи сообщения: " + err.message);
    } finally {
      setIsSending(false);
    }
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

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span>Диалог и хронология сообщений</span>
        </CardTitle>

        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-xs">
          <Link href={`/conversations?clientId=${clientId}`}>
            <span>Открыть в диалогах</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Banner */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            Ручная запись сообщений: переписка сохраняется во внутренней базе CRM для фиксации взаимодействий с клиентом.
          </span>
        </div>

        {/* Message timeline */}
        <div className="border rounded-md p-3 space-y-3 min-h-[180px] max-h-[380px] overflow-y-auto bg-muted/10">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground py-8">
              <Clock className="h-8 w-8 mb-2 opacity-20" />
              <p className="text-xs font-medium">История сообщений пуста</p>
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
                    className={`max-w-[85%] rounded-lg p-2.5 shadow-xs space-y-1 ${
                      isOutbound
                        ? "bg-primary/10 text-foreground border border-primary/20 rounded-br-xs"
                        : "bg-card text-card-foreground border rounded-bl-xs"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground/80">
                        {isOutbound ? (msg.senderName || "Сотрудник") : clientName}
                      </span>
                      <div className="flex items-center gap-1">
                        {getChannelBadge(msg.channel)}
                        <span>
                          {format(new Date(msg.sentAt), "d MMM, HH:mm", { locale: ru })}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs whitespace-pre-wrap break-words leading-relaxed text-foreground">
                      {msg.body}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Message Composer */}
        <form onSubmit={handleSend} className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Введите текст сообщения или ручную заметку..."
            className="min-h-[70px] text-xs resize-none"
          />

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!text.trim() || isSending}
              className="gap-1.5 text-xs h-8"
            >
              <Send className="h-3 w-3" />
              <span>{isSending ? "Запись..." : "Записать сообщение"}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
