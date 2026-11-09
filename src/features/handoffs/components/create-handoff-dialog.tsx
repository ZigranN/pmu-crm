"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createHandoffAction } from "../server/actions";
import type {
  HandoffEntityType,
  HandoffPriority,
} from "../domain/types";
import { toast } from "sonner";

interface StaffMember {
  userId: string;
  name: string;
  roleName: string;
}

interface CreateHandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMembers: StaffMember[];
  defaultEntityType?: HandoffEntityType;
  defaultEntityId?: string;
  defaultClientId?: string;
  defaultCycleId?: string;
  defaultConversationId?: string;
  defaultAppointmentId?: string;
  onSuccess?: () => void;
}

export function CreateHandoffDialog({
  open,
  onOpenChange,
  staffMembers,
  defaultEntityType = "CLIENT",
  defaultEntityId = "",
  defaultClientId,
  defaultCycleId,
  defaultConversationId,
  defaultAppointmentId,
  onSuccess,
}: CreateHandoffDialogProps) {
  const [entityType, setEntityType] = useState<HandoffEntityType>(defaultEntityType);
  const [entityId, setEntityId] = useState<string>(defaultEntityId);
  const [toUserId, setToUserId] = useState<string>(
    staffMembers.length > 0 ? staffMembers[0].userId : ""
  );
  const [reasonCode, setReasonCode] = useState<string>("OPERATIONAL_HANDOFF");
  const [reasonText, setReasonText] = useState<string>("");
  const [priority, setPriority] = useState<HandoffPriority>("NORMAL");
  const [dueDays, setDueDays] = useState<string>("1");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toUserId) {
      toast.error("Выберите сотрудника для передачи");
      return;
    }
    if (!entityId.trim()) {
      toast.error("Укажите идентификатор сущности");
      return;
    }

    setIsSubmitting(true);
    try {
      const dueAt =
        dueDays && !isNaN(Number(dueDays)) && Number(dueDays) > 0
          ? new Date(Date.now() + Number(dueDays) * 24 * 60 * 60 * 1000)
          : null;

      await createHandoffAction({
        entityType,
        entityId: entityId.trim(),
        clientId: defaultClientId ?? (entityType === "CLIENT" ? entityId.trim() : null),
        cycleId: defaultCycleId ?? (entityType === "TREATMENT_CYCLE" ? entityId.trim() : null),
        conversationId:
          defaultConversationId ??
          (entityType === "CONVERSATION" ? entityId.trim() : null),
        appointmentId:
          defaultAppointmentId ??
          (entityType === "APPOINTMENT" ? entityId.trim() : null),
        toUserId,
        sourceType: "HUMAN",
        reasonCode: reasonCode.trim() || "OPERATIONAL_HANDOFF",
        reasonText: reasonText.trim() || undefined,
        priority,
        dueAt,
      });

      toast.success("Передача ответственности успешно создана");
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || "Не удалось создать передачу");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Передать задачу / ответственность</DialogTitle>
          <DialogDescription>
            Назначьте сотрудника, укажите причину передачи и срок исполнения.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="entityType" className="text-xs">
                Тип объекта
              </Label>
              <Select
                value={entityType}
                onValueChange={(val) => setEntityType(val as HandoffEntityType)}
              >
                <SelectTrigger id="entityType" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLIENT">Клиент</SelectItem>
                  <SelectItem value="CONVERSATION">Диалог</SelectItem>
                  <SelectItem value="APPOINTMENT">Запись</SelectItem>
                  <SelectItem value="TREATMENT_CYCLE">Цикл PMU</SelectItem>
                  <SelectItem value="NEEDS_ATTENTION_ITEM">Требует внимания</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="priority" className="text-xs">
                Приоритет
              </Label>
              <Select
                value={priority}
                onValueChange={(val) => setPriority(val as HandoffPriority)}
              >
                <SelectTrigger id="priority" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="URGENT">Срочный (URGENT)</SelectItem>
                  <SelectItem value="HIGH">Высокий (HIGH)</SelectItem>
                  <SelectItem value="NORMAL">Обычный (NORMAL)</SelectItem>
                  <SelectItem value="LOW">Низкий (LOW)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="entityId" className="text-xs">
              ID объекта
            </Label>
            <Input
              id="entityId"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="UUID объекта (клиента, диалога, записи...)"
              className="h-9 text-xs font-mono"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="toUserId" className="text-xs">
              Кому передать
            </Label>
            <Select value={toUserId} onValueChange={setToUserId}>
              <SelectTrigger id="toUserId" className="h-9 text-xs">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {staffMembers.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name} ({m.roleName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reasonCode" className="text-xs">
                Код причины
              </Label>
              <Input
                id="reasonCode"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="OPERATIONAL_HANDOFF"
                className="h-9 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dueDays" className="text-xs">
                Срок (дней)
              </Label>
              <Input
                id="dueDays"
                type="number"
                min="0"
                max="30"
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value)}
                placeholder="1"
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reasonText" className="text-xs">
              Комментарий / Описание
            </Label>
            <Textarea
              id="reasonText"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Опишите, что нужно сделать..."
              rows={3}
              className="text-xs resize-none"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Передаём..." : "Передать ответственность"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
