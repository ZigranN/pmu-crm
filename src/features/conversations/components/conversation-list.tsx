"use client";

import * as React from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Search, UserCheck, MessageSquare, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ConversationListItem, MessageChannel } from "../domain/types";

interface ConversationListProps {
  conversations: ConversationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: "all" | "unread" | "mine" | "open" | "closed";
  onFilterChange: (filter: "all" | "unread" | "mine" | "open" | "closed") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
}: ConversationListProps) {
  const getChannelBadge = (channel: MessageChannel | null) => {
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

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase() || "КЛ";
  };

  return (
    <div className="flex flex-col h-full border-r bg-background">
      {/* Header & Search */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по клиенту или телефону..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => onFilterChange("all")}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Все
          </button>
          <button
            onClick={() => onFilterChange("unread")}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
              filter === "unread"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Непрочитанные
          </button>
          <button
            onClick={() => onFilterChange("mine")}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
              filter === "mine"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Мои
          </button>
          <button
            onClick={() => onFilterChange("open")}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
              filter === "open"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Открытые
          </button>
          <button
            onClick={() => onFilterChange("closed")}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
              filter === "closed"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Закрытые
          </button>
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y">
        {conversations.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Нет диалогов
          </div>
        ) : (
          conversations.map((item) => {
            const isSelected = item.id === selectedId;
            const hasUnread = item.unreadCount > 0;

            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`w-full text-left p-3 transition-colors flex items-start gap-3 hover:bg-muted/50 ${
                  isSelected ? "bg-muted/80" : ""
                } ${hasUnread ? "bg-primary/5" : ""}`}
              >
                <Avatar className="h-10 w-10 shrink-0 border">
                  <AvatarFallback className="text-xs font-semibold bg-muted">
                    {getInitials(item.clientName)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className={`text-sm truncate ${hasUnread ? "font-bold text-foreground" : "font-medium"}`}>
                      {item.clientName}
                    </span>
                    {item.lastMessageAt && (
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {format(new Date(item.lastMessageAt), "d MMM, HH:mm", { locale: ru })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 mb-1.5">
                    {getChannelBadge(item.lastMessageChannel)}
                    {item.cycleZoneCode && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">
                        {item.cycleZoneCode}
                      </Badge>
                    )}
                    {item.status === "CLOSED" && (
                      <Badge variant="outline" className="text-muted-foreground text-[10px] px-1 py-0 flex items-center gap-0.5">
                        <Lock className="h-2.5 w-2.5" />
                        Закрыт
                      </Badge>
                    )}
                  </div>

                  <p className={`text-xs truncate ${hasUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {item.lastMessageDirection === "OUTBOUND" ? "Вы: " : ""}
                    {item.lastMessagePreview || "Нет сообщений"}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-border/40 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 truncate max-w-[160px]">
                      {item.assignedUserName ? (
                        <>
                          <UserCheck className="h-3 w-3 shrink-0 text-primary" />
                          <span className="truncate">{item.assignedUserName}</span>
                        </>
                      ) : (
                        <span className="italic text-muted-foreground/70">Не назначен</span>
                      )}
                    </span>

                    {hasUnread && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] h-4 min-w-4 px-1 rounded-full flex items-center justify-center font-bold">
                        {item.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
