"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type {
  HandoffQueueItem,
} from "../domain/types";
import { HandoffCard } from "./handoff-card";
import { CreateHandoffDialog } from "./create-handoff-dialog";
import {
  acceptHandoffAction,
  cancelHandoffAction,
  completeHandoffAction,
  listHandoffsAction,
  rejectHandoffAction,
} from "../server/actions";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  Search,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

interface StaffMember {
  userId: string;
  name: string;
  roleName: string;
}

interface HandoffsQueueProps {
  initialItems: HandoffQueueItem[];
  staffMembers: StaffMember[];
  currentUserId: string;
}

type TabType = "pendingToMe" | "acceptedByMe" | "createdByMe" | "overdue" | "all";

export function HandoffsQueue({
  initialItems,
  staffMembers,
  currentUserId,
}: HandoffsQueueProps) {
  const [items, setItems] = useState<HandoffQueueItem[]>(initialItems);
  const [activeTab, setActiveTab] = useState<TabType>("pendingToMe");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Dialogs
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [rejectItem, setRejectItem] = useState<HandoffQueueItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const refreshItems = async () => {
    setIsRefreshing(true);
    try {
      const updated = await listHandoffsAction();
      setItems(updated);
    } catch (err: any) {
      toast.error(err.message || "Не удалось обновить список передач");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAccept = async (id: string) => {
    setProcessingId(id);
    try {
      await acceptHandoffAction({ handoffId: id });
      toast.success("Ответственность принята");
      await refreshItems();
    } catch (err: any) {
      toast.error(err.message || "Не удалось принять передачу");
    } finally {
      setProcessingId(null);
    }
  };

  const handleOpenReject = (item: HandoffQueueItem) => {
    setRejectItem(item);
    setRejectReason("");
  };

  const handleConfirmReject = async () => {
    if (!rejectItem) return;
    if (!rejectReason.trim()) {
      toast.error("Укажите причину отклонения");
      return;
    }

    setIsRejecting(true);
    try {
      await rejectHandoffAction({
        handoffId: rejectItem.id,
        reason: rejectReason.trim(),
      });
      toast.success("Передача отклонена");
      setRejectItem(null);
      await refreshItems();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отклонить передачу");
    } finally {
      setIsRejecting(false);
    }
  };

  const handleComplete = async (id: string) => {
    setProcessingId(id);
    try {
      await completeHandoffAction({ handoffId: id });
      toast.success("Задача завершена");
      await refreshItems();
    } catch (err: any) {
      toast.error(err.message || "Не удалось завершить задачу");
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setProcessingId(id);
    try {
      await cancelHandoffAction({ handoffId: id });
      toast.success("Передача отменена");
      await refreshItems();
    } catch (err: any) {
      toast.error(err.message || "Не удалось отменить передачу");
    } finally {
      setProcessingId(null);
    }
  };

  // Filter items by tab and query
  const filteredItems = items.filter((item) => {
    // 1. Tab filter
    if (activeTab === "pendingToMe") {
      if (item.status !== "PENDING" || item.toUserId !== currentUserId) {
        return false;
      }
    } else if (activeTab === "acceptedByMe") {
      if (item.status !== "ACCEPTED" || item.toUserId !== currentUserId) {
        return false;
      }
    } else if (activeTab === "createdByMe") {
      if (item.createdById !== currentUserId) {
        return false;
      }
    } else if (activeTab === "overdue") {
      if (!item.isOverdue) {
        return false;
      }
    }

    // 2. Priority filter
    if (priorityFilter !== "ALL" && item.priority !== priorityFilter) {
      return false;
    }

    // 3. Entity filter
    if (entityFilter !== "ALL" && item.entityType !== entityFilter) {
      return false;
    }

    // 4. Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchReason = item.reasonCode.toLowerCase().includes(q);
      const matchText = (item.reasonText || "").toLowerCase().includes(q);
      const matchClient = (item.clientName || "").toLowerCase().includes(q);
      const matchPhone = (item.clientPhone || "").toLowerCase().includes(q);
      const matchAssignee = (item.toUserName || "").toLowerCase().includes(q);
      if (
        !matchReason &&
        !matchText &&
        !matchClient &&
        !matchPhone &&
        !matchAssignee
      ) {
        return false;
      }
    }

    return true;
  });

  // Calculate counts for badges
  const pendingToMeCount = items.filter(
    (i) => i.status === "PENDING" && i.toUserId === currentUserId
  ).length;
  const acceptedByMeCount = items.filter(
    (i) => i.status === "ACCEPTED" && i.toUserId === currentUserId
  ).length;
  const createdByMeCount = items.filter(
    (i) => i.createdById === currentUserId
  ).length;
  const overdueCount = items.filter((i) => i.isOverdue).length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ArrowRightLeft className="w-6 h-6 text-primary" />
            Очередь передач и задач
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Оперативная передача ответственности между сотрудниками, автоматизацией и AI.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshItems}
            disabled={isRefreshing}
            className="h-9 text-xs"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Обновить
          </Button>

          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="h-9 text-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Создать передачу
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <Button
          variant={activeTab === "pendingToMe" ? "default" : "outline"}
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={() => setActiveTab("pendingToMe")}
        >
          <Clock className="w-3.5 h-3.5" />
          Мне передано
          {pendingToMeCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 text-[10px] px-1.5 py-0 bg-primary/20 text-primary-foreground font-semibold"
            >
              {pendingToMeCount}
            </Badge>
          )}
        </Button>

        <Button
          variant={activeTab === "acceptedByMe" ? "default" : "outline"}
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={() => setActiveTab("acceptedByMe")}
        >
          <UserCheck className="w-3.5 h-3.5" />
          Принятые мной
          {acceptedByMeCount > 0 && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
              {acceptedByMeCount}
            </Badge>
          )}
        </Button>

        <Button
          variant={activeTab === "createdByMe" ? "default" : "outline"}
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={() => setActiveTab("createdByMe")}
        >
          <Plus className="w-3.5 h-3.5" />
          Созданные мной
          {createdByMeCount > 0 && (
            <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0">
              {createdByMeCount}
            </Badge>
          )}
        </Button>

        <Button
          variant={activeTab === "overdue" ? "default" : "outline"}
          size="sm"
          className="text-xs h-8 gap-1.5"
          onClick={() => setActiveTab("overdue")}
        >
          <AlertCircle className="w-3.5 h-3.5 text-destructive" />
          Просроченные
          {overdueCount > 0 && (
            <Badge
              variant="destructive"
              className="ml-1 text-[10px] px-1.5 py-0"
            >
              {overdueCount}
            </Badge>
          )}
        </Button>

        <Button
          variant={activeTab === "all" ? "default" : "outline"}
          size="sm"
          className="text-xs h-8"
          onClick={() => setActiveTab("all")}
        >
          Все ({items.length})
        </Button>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по причине, клиенту, сотруднику..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger aria-label="Фильтр по приоритету" className="w-[140px] h-9 text-xs">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Все приоритеты</SelectItem>
              <SelectItem value="URGENT">Срочный</SelectItem>
              <SelectItem value="HIGH">Высокий</SelectItem>
              <SelectItem value="NORMAL">Обычный</SelectItem>
              <SelectItem value="LOW">Низкий</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="Тип объекта" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Все типы</SelectItem>
              <SelectItem value="CLIENT">Клиент</SelectItem>
              <SelectItem value="CONVERSATION">Диалог</SelectItem>
              <SelectItem value="APPOINTMENT">Запись</SelectItem>
              <SelectItem value="TREATMENT_CYCLE">Цикл PMU</SelectItem>
              <SelectItem value="NEEDS_ATTENTION_ITEM">Внимание</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Item List */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 border border-dashed rounded-lg bg-card/50">
            <CheckCircle2 className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
            <h3 className="text-sm font-medium text-foreground">
              Нет задач в этой вкладке
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Все переданные вам задачи выполнены или отсутствуют по текущим фильтрам.
            </p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <HandoffCard
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              onAccept={handleAccept}
              onOpenReject={handleOpenReject}
              onComplete={handleComplete}
              onCancel={handleCancel}
              isProcessing={processingId === item.id}
            />
          ))
        )}
      </div>

      {/* Reject Modal */}
      <Dialog
        open={Boolean(rejectItem)}
        onOpenChange={(open) => !open && setRejectItem(null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Отклонить передачу</DialogTitle>
            <DialogDescription>
              Укажите обязательную причину отклонения ответственности.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label htmlFor="rejectReason" className="text-xs">
              Причина отклонения <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rejectReason"
              placeholder="Например: Не моя специализация / Клиент уже записан к другому мастеру..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="text-xs resize-none"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRejectItem(null)}
              disabled={isRejecting}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmReject}
              disabled={isRejecting || !rejectReason.trim()}
            >
              {isRejecting ? "Отклоняем..." : "Отклонить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Handoff Modal */}
      <CreateHandoffDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        staffMembers={staffMembers}
        onSuccess={refreshItems}
      />
    </div>
  );
}
