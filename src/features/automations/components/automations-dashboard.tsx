"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  RotateCw,
  XCircle,
  Plus,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  createAutomationRuleAction,
  toggleAutomationRuleAction,
  seedDefaultRulesAction,
  retryAutomationJobAction,
  cancelAutomationJobAction,
  processAutomationJobsAction,
} from "../server/actions";
import type {
  AutomationRuleWithStats,
  AutomationJobItem,
  AutomationExecutionItem,
  AutomationStatsSummary,
} from "../server/queries";
import {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
  type AutomationTriggerType,
  type AutomationActionType,
} from "../domain/types";

interface AutomationsDashboardProps {
  rules: AutomationRuleWithStats[];
  jobs: AutomationJobItem[];
  executions: AutomationExecutionItem[];
  stats: AutomationStatsSummary;
  userRole?: string | null;
}

export function AutomationsDashboard({
  rules,
  jobs,
  executions,
  stats,
  userRole,
}: AutomationsDashboardProps) {
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const canManage = userRole === "OWNER" || userRole === "ADMIN" || userRole === "SUPER_ADMIN";

  // Create rule form state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>("APPOINTMENT_CREATED");
  const [actionType, setActionType] = useState<AutomationActionType>("CREATE_OPERATIONAL_REMINDER");
  const [offsetMinutes, setOffsetMinutes] = useState("-1440");
  const [titleTemplate, setTitleTemplate] = useState("Операционное напоминание");

  const handleToggle = (ruleId: string, currentEnabled: boolean) => {
    startTransition(async () => {
      try {
        await toggleAutomationRuleAction(ruleId, !currentEnabled);
        toast.success(currentEnabled ? "Правило отключено" : "Правило включено");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка изменения статуса");
      }
    });
  };

  const handleSeedDefaults = () => {
    startTransition(async () => {
      try {
        const res = await seedDefaultRulesAction();
        toast.success(`Стандартные правила созданы (${res.count})`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка создания стандартных правил");
      }
    });
  };

  const handleRetryJob = (jobId: string) => {
    startTransition(async () => {
      try {
        await retryAutomationJobAction(jobId);
        toast.success("Задача поставлена в очередь на повтор");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка повторного запуска");
      }
    });
  };

  const handleCancelJob = (jobId: string) => {
    startTransition(async () => {
      try {
        await cancelAutomationJobAction(jobId);
        toast.success("Задача отменена");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка отмены задачи");
      }
    });
  };

  const handleRunWorker = () => {
    startTransition(async () => {
      try {
        const res = await processAutomationJobsAction();
        toast.success(`Обработано задач: ${res.processed}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка обработки задач");
      }
    });
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        let config: Record<string, unknown> = { titleTemplate };
        if (triggerType.startsWith("APPOINTMENT")) {
          config = {
            ...config,
            offsetMinutes: parseInt(offsetMinutes, 10) || -1440,
          };
        } else if (triggerType.startsWith("CONVERSATION")) {
          config = {
            ...config,
            durationMinutes: 30,
          };
        } else if (triggerType === "PROCEDURE_COMPLETED") {
          config = {
            ...config,
            delayDays: 3,
            delayHours: 0,
          };
        }

        await createAutomationRuleAction({
          code,
          name,
          description: description || null,
          enabled: true,
          triggerType,
          actionType,
          config,
        });

        toast.success("Правило успешно создано");
        setCreateOpen(false);
        setCode("");
        setName("");
        setDescription("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка создания правила");
      }
    });
  };

  const formatConfigSummary = (rule: AutomationRuleWithStats) => {
    const cfg = rule.config;
    if ("offsetMinutes" in cfg && typeof cfg.offsetMinutes === "number") {
      const mins = cfg.offsetMinutes;
      if (mins < 0) {
        const hours = Math.abs(mins) / 60;
        return `За ${hours >= 24 ? `${hours / 24} дн.` : `${hours} ч.`} до начала`;
      }
      return `Через ${mins / 60} ч. после начала`;
    }
    if ("durationMinutes" in cfg && typeof cfg.durationMinutes === "number") {
      return `Через ${cfg.durationMinutes} мин. без ответа`;
    }
    if ("delayDays" in cfg && typeof cfg.delayDays === "number") {
      return `Через ${cfg.delayDays} дн. после завершения`;
    }
    return "Срабатывает сразу";
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "succeeded":
      case "completed":
        return <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Успешно</Badge>;
      case "scheduled":
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-800">Запланировано</Badge>;
      case "running":
      case "processing":
        return <Badge className="bg-blue-600 text-white">Выполняется</Badge>;
      case "failed":
      case "dead":
        return <Badge variant="destructive">Ошибка</Badge>;
      case "cancelled":
        return <Badge variant="outline" className="text-muted-foreground">Отменено</Badge>;
      case "skipped":
        return <Badge variant="outline" className="text-muted-foreground">Пропущено</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-taupe flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-600" />
            Автоматизации и фоновые задачи
          </h1>
          <p className="text-sm text-muted-foreground">
            Детерминированные правила напоминаний, контроль диалогов и надежная outbox-очередь
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunWorker}
            disabled={isPending}
            className="flex items-center gap-1.5"
          >
            <Play className="h-4 w-4" />
            Запустить обработку
          </Button>

          {canManage && (
            <>
              {rules.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSeedDefaults}
                  disabled={isPending}
                  className="flex items-center gap-1.5"
                >
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  Установить стандарты
                </Button>
              )}

              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-taupe hover:bg-taupe/90 text-white flex items-center gap-1.5">
                    <Plus className="h-4 w-4" />
                    Создать правило
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <form onSubmit={handleCreateRule}>
                    <DialogHeader>
                      <DialogTitle>Новое правило автоматизации</DialogTitle>
                      <DialogDescription>
                        Настройте триггер, действие и параметр�� расписания.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="code">Уникальный код</Label>
                        <Input
                          id="code"
                          placeholder="appointment_reminder_24h"
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          required
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="name">Название</Label>
                        <Input
                          id="name"
                          placeholder="Напоминание о записи за 24 часа"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          required
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="trigger">Событие (Триггер)</Label>
                        <Select
                          value={triggerType}
                          onValueChange={(v) => setTriggerType(v as AutomationTriggerType)}
                        >
                          <SelectTrigger id="trigger">
                            <SelectValue placeholder="Выберите триггер" />
                          </SelectTrigger>
                          <SelectContent>
                            {AUTOMATION_TRIGGER_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="action">Действие</Label>
                        <Select
                          value={actionType}
                          onValueChange={(v) => setActionType(v as AutomationActionType)}
                        >
                          <SelectTrigger id="action">
                            <SelectValue placeholder="Выберите действие" />
                          </SelectTrigger>
                          <SelectContent>
                            {AUTOMATION_ACTION_TYPES.map((a) => (
                              <SelectItem key={a} value={a}>
                                {a}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {triggerType.startsWith("APPOINTMENT") && (
                        <div className="grid gap-2">
                          <Label htmlFor="offset">Смещение по времени (минуты)</Label>
                          <Input
                            id="offset"
                            type="number"
                            placeholder="-1440 (-24 часа)"
                            value={offsetMinutes}
                            onChange={(e) => setOffsetMinutes(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Отрицательное значение — до начала записи (например, -1440 = за 24ч, -120 = за 2ч).
                          </p>
                        </div>
                      )}

                      <div className="grid gap-2">
                        <Label htmlFor="titleTpl">Заголовок создаваемой задачи</Label>
                        <Input
                          id="titleTpl"
                          value={titleTemplate}
                          onChange={(e) => setTitleTemplate(e.target.value)}
                          required
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="desc">Описание</Label>
                        <Textarea
                          id="desc"
                          placeholder="Краткое описание правила"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>
                    </div>

                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                        Отмена
                      </Button>
                      <Button type="submit" disabled={isPending}>
                        Сохранить
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Активные правила</CardDescription>
            <CardTitle className="text-2xl font-bold">
              {stats.activeRules} <span className="text-xs text-muted-foreground font-normal">из {stats.totalRules}</span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Запланировано задач</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-600">
              {stats.pendingJobs}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Успешных выполнений</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-600">
              {stats.succeededExecutions}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs">Ошибок в очереди</CardDescription>
            <CardTitle className={`text-2xl font-bold ${stats.failedJobs > 0 ? "text-red-600" : "text-muted-foreground"}`}>
              {stats.failedJobs}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules" className="flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            Правила ({rules.length})
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Очередь и задачи ({jobs.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            История выполнений ({executions.length})
          </TabsTrigger>
        </TabsList>

        {/* Rules Tab */}
        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Список правил автоматизации</CardTitle>
              <CardDescription>
                Настроенные сценарии для студии. Отключение правила прекращает постановку новых задач.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {rules.length === 0 ? (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500 opacity-60" />
                  <p className="font-medium">Правила автоматизации еще не созданы</p>
                  <p className="text-xs mt-1">Установите стандартные правила студии одним кликом</p>
                  {canManage && (
                    <Button
                      size="sm"
                      onClick={handleSeedDefaults}
                      disabled={isPending}
                      className="mt-4"
                    >
                      Установить стандартные правила
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {rules.map((rule) => (
                    <div key={rule.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-sm text-taupe">{rule.name}</h3>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {rule.code}
                          </Badge>
                          {rule.enabled ? (
                            <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Включено</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">Отключено</Badge>
                          )}
                        </div>
                        {rule.description && (
                          <p className="text-xs text-muted-foreground">{rule.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                          <span>Триггер: <span className="font-mono text-taupe">{rule.triggerType}</span></span>
                          <span>Действие: <span className="font-mono text-taupe">{rule.actionType}</span></span>
                          <span>Срок: <span className="text-taupe font-medium">{formatConfigSummary(rule)}</span></span>
                          <span>Выполнений: <span className="font-medium text-taupe">{rule.executionCount}</span></span>
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <Button
                            variant={rule.enabled ? "outline" : "default"}
                            size="sm"
                            onClick={() => handleToggle(rule.id, rule.enabled)}
                            disabled={isPending}
                          >
                            {rule.enabled ? "Отключить" : "Включить"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Jobs Tab */}
        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Очередь фоновых задач (Outbox Jobs)</CardTitle>
              <CardDescription>
                Задачи, ожидающие наступления срока выполнения или находящиеся в процессе обработки.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <p className="font-medium">Очередь задач пуста</p>
                  <p className="text-xs mt-1">Все фоновые задачи обработаны или еще не запланированы</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {jobs.map((job) => (
                    <div key={job.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-taupe">{job.eventKey}</span>
                          {renderStatusBadge(job.state)}
                          <span className="text-xs text-muted-foreground">
                            Попытка {job.attempts} / {job.maxAttempts}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Обработчик: <span className="font-mono">{job.handler}</span></span>
                          <span>Срок: <span>{new Date(job.availableAt).toLocaleString("ru-RU")}</span></span>
                          {job.entityType && (
                            <span>Объект: <span className="font-mono">{job.entityType}:{job.entityId}</span></span>
                          )}
                        </div>
                        {job.lastError && (
                          <p className="text-xs text-red-600 bg-red-50 p-1.5 rounded mt-1 font-mono">
                            {job.lastError}
                          </p>
                        )}
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          {(job.state === "dead" || job.state === "uncertain") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRetryJob(job.id)}
                              disabled={isPending}
                              className="flex items-center gap-1"
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                              Повторить
                            </Button>
                          )}
                          {(job.state === "pending" || job.state === "processing") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelJob(job.id)}
                              disabled={isPending}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Отменить
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Executions History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Журнал истории выполнений</CardTitle>
              <CardDescription>
                Хронологический отчет о срабатывании правил автоматизации и результатах выполнения.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {executions.length === 0 ? (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <p className="font-medium">История выполнений пуста</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {executions.map((exec) => (
                    <div key={exec.id} className="p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs text-taupe">
                            {exec.ruleName ?? exec.ruleCode ?? exec.triggerType}
                          </span>
                          {renderStatusBadge(exec.status)}
                          <span className="text-xs text-muted-foreground">
                            Попыток: {exec.attemptCount}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {exec.executedAt
                            ? new Date(exec.executedAt).toLocaleString("ru-RU")
                            : new Date(exec.scheduledFor).toLocaleString("ru-RU")}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Триггер: <span className="font-mono">{exec.triggerType}</span></span>
                        <span>Действие: <span className="font-mono">{exec.actionType}</span></span>
                        <span>Объект: <span className="font-mono">{exec.entityType}:{exec.entityId}</span></span>
                      </div>

                      {exec.lastError && (
                        <p className="text-xs text-red-600 bg-red-50 p-1.5 rounded mt-1 font-mono">
                          {exec.lastError}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
