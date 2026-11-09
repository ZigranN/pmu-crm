"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { ConversationList } from "./conversation-list";
import { ConversationDetail } from "./conversation-detail";
import {
  sendManualMessageAction,
  markConversationReadAction,
  assignConversationAction,
  closeConversationAction,
  reopenConversationAction,
  listConversationMessagesAction,
  getConversationAction,
} from "../server/actions";
import type {
  ConversationListItem,
  ConversationMessageRecord,
} from "../domain/types";

interface ConversationsInboxProps {
  initialConversations: ConversationListItem[];
  staffMembers: { id: string; name: string }[];
  initialSelectedId?: string | null;
}

export function ConversationsInbox({
  initialConversations,
  staffMembers,
  initialSelectedId,
}: ConversationsInboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = React.useState<ConversationListItem[]>(initialConversations);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialSelectedId || (initialConversations.length > 0 ? initialConversations[0].id : null)
  );

  const [filter, setFilter] = React.useState<"all" | "unread" | "mine" | "open" | "closed">("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  const [activeConversation, setActiveConversation] = React.useState<any | null>(null);
  const [messages, setMessages] = React.useState<ConversationMessageRecord[]>([]);
  const [isPending, startTransition] = React.useTransition();
  const [isSending, setIsSending] = React.useState(false);

  // Load active conversation & messages when selectedId changes
  React.useEffect(() => {
    if (!selectedId) {
      return;
    }

    let isMounted = true;

    startTransition(async () => {
      try {
        const [conv, msgs] = await Promise.all([
          getConversationAction(selectedId),
          listConversationMessagesAction(selectedId),
        ]);
        if (!isMounted) return;
        setActiveConversation(conv);
        setMessages(msgs);
      } catch (err: any) {
        if (!isMounted) return;
        toast.error("Ошибка загрузки диалога: " + err.message);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [selectedId]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", id);
    router.replace(`/conversations?${params.toString()}`);
  };

  const handleSendMessage = async (body: string) => {
    if (!activeConversation) return;
    setIsSending(true);

    try {
      const res = await sendManualMessageAction({
        clientId: activeConversation.clientId,
        conversationId: activeConversation.id,
        cycleId: activeConversation.cycleId ?? undefined,
        body,
      });

      // Append message locally
      setMessages((prev) => [...prev, { ...res.message, senderName: "Вы" }]);

      // Update conversation in list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                lastMessageAt: new Date(res.message.sentAt),
                lastMessagePreview: res.message.body,
                lastMessageChannel: res.message.channel,
                lastMessageDirection: res.message.direction,
                unreadCount: 0,
              }
            : c
        )
      );

      toast.success("Сообщение записано");
    } catch (err: any) {
      toast.error("Не удалось записать сообщение: " + err.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleMarkRead = async () => {
    if (!activeConversation) return;

    try {
      await markConversationReadAction({
        conversationId: activeConversation.id,
      });

      setActiveConversation((prev: any) => (prev ? { ...prev, unreadCount: 0 } : null));

      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, unreadCount: 0 } : c))
      );

      toast.success("Диалог отмечен как прочитанный");
    } catch (err: any) {
      toast.error("Ошибка: " + err.message);
    }
  };

  const handleAssign = async (userId: string | null) => {
    if (!activeConversation) return;

    try {
      await assignConversationAction({
        conversationId: activeConversation.id,
        assignedUserId: userId,
        reason: "manual_assignment_ui",
      });

      const member = staffMembers.find((m) => m.id === userId);

      setActiveConversation((prev: any) =>
        prev
          ? {
              ...prev,
              assignedUserId: userId,
              assignedUser: member ? { id: member.id, name: member.name } : null,
            }
          : null
      );

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversation.id
            ? {
                ...c,
                assignedUserId: userId,
                assignedUserName: member?.name ?? null,
              }
            : c
        )
      );

      toast.success(userId ? "Ответственный назначен" : "Назначение снято");
    } catch (err: any) {
      toast.error("Ошибка назначения: " + err.message);
    }
  };

  const handleToggleStatus = async () => {
    if (!activeConversation) return;

    try {
      if (activeConversation.status === "OPEN") {
        await closeConversationAction({
          conversationId: activeConversation.id,
          reason: "closed_by_staff",
        });

        setActiveConversation((prev: any) => (prev ? { ...prev, status: "CLOSED" } : null));
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversation.id ? { ...c, status: "CLOSED" } : c))
        );
        toast.success("Диалог закрыт");
      } else {
        await reopenConversationAction({
          conversationId: activeConversation.id,
          reason: "reopened_by_staff",
        });

        setActiveConversation((prev: any) => (prev ? { ...prev, status: "OPEN" } : null));
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversation.id ? { ...c, status: "OPEN" } : c))
        );
        toast.success("Диалог открыт");
      }
    } catch (err: any) {
      toast.error("Ошибка изменения статуса: " + err.message);
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter((c) => {
    if (filter === "unread" && c.unreadCount === 0) return false;
    if (filter === "open" && c.status !== "OPEN") return false;
    if (filter === "closed" && c.status !== "CLOSED") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = c.clientName.toLowerCase().includes(q);
      const matchPhone = c.clientPhone?.includes(q);
      if (!matchName && !matchPhone) return false;
    }

    return true;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 h-[calc(100vh-4rem)] border rounded-lg overflow-hidden bg-card">
      {/* Left List Pane */}
      <div className="md:col-span-4 lg:col-span-4 h-full overflow-hidden">
        <ConversationList
          conversations={filteredConversations}
          selectedId={selectedId}
          onSelect={handleSelect}
          filter={filter}
          onFilterChange={setFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
      </div>

      {/* Right Detail Pane */}
      <div className="hidden md:block md:col-span-8 lg:col-span-8 h-full overflow-hidden">
        {isPending ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Загрузка диалога...
          </div>
        ) : activeConversation ? (
          <ConversationDetail
            conversation={activeConversation}
            messages={messages}
            staffMembers={staffMembers}
            onSendMessage={handleSendMessage}
            onMarkRead={handleMarkRead}
            onAssign={handleAssign}
            onToggleStatus={handleToggleStatus}
            isSending={isSending}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-8">
            <MessageSquare className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-base font-medium">Выберите диалог для просмотра</p>
            <p className="text-xs mt-1 text-muted-foreground/80 max-w-sm">
              В списке слева отображаются все диалоги и обращения клиентов студии.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
