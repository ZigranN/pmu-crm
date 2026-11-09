"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/money";
import { type OperationsDashboardData } from "../server/queries";
import { RetryJobButton } from "./retry-job-button";

interface OperationsDashboardProps {
  data: OperationsDashboardData;
}

export function OperationsDashboard({ data }: OperationsDashboardProps) {
  const {
    overallStatus,
    readiness,
    outbox,
    automations,
    googleCalendar,
    ai,
    handoffs,
    dailyPaymentReport,
    timestamp,
  } = data;

  const getStatusBadge = (status: "healthy" | "degraded" | "unhealthy") => {
    switch (status) {
      case "healthy":
        return <Badge className="bg-emerald-600 text-white">ЗДОРОВА</Badge>;
      case "degraded":
        return <Badge className="bg-amber-600 text-white">ДЕГРАДИРОВАНА</Badge>;
      case "unhealthy":
        return <Badge variant="destructive">НЕИСПРАВНА</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Операционная панель (Operations)</h1>
          <p className="text-sm text-muted-foreground">
            Мониторинг доступности, очередей фоновых задач, интеграций и метрик AI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Обновлено: {new Date(timestamp).toLocaleTimeString()}
          </span>
          {getStatusBadge(overallStatus)}
        </div>
      </div>

      {/* Section: Daily Payment Report (Req 29) */}
      {dailyPaymentReport && (
        <Card data-testid="daily-payment-report">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span>Дневной финансовый отчёт (Daily Payment Report)</span>
              <span className="text-xs text-muted-foreground">Дата: {dailyPaymentReport.date}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded border p-3">
                <span className="text-xs text-muted-foreground block">Наличные (Cash)</span>
                <span className="text-base font-bold text-foreground" data-testid="report-cash">
                  {formatCents(dailyPaymentReport.cashMinor)}
                </span>
              </div>
              <div className="rounded border p-3">
                <span className="text-xs text-muted-foreground block">Банковская карта (Card)</span>
                <span className="text-base font-bold text-foreground" data-testid="report-card">
                  {formatCents(dailyPaymentReport.cardMinor)}
                </span>
              </div>
              <div className="rounded border p-3">
                <span className="text-xs text-muted-foreground block">Банковский перевод (Bank)</span>
                <span className="text-base font-bold text-foreground" data-testid="report-bank">
                  {formatCents(dailyPaymentReport.bankTransferMinor)}
                </span>
              </div>
              <div className="rounded border p-3">
                <span className="text-xs text-muted-foreground block">Прочие методы (Other)</span>
                <span className="text-base font-bold text-foreground" data-testid="report-other">
                  {formatCents(dailyPaymentReport.otherMinor)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="rounded border p-3 bg-muted/40">
                <span className="text-xs text-muted-foreground block">Всего получено</span>
                <span className="text-lg font-extrabold text-emerald-600" data-testid="report-total-received">
                  {formatCents(dailyPaymentReport.totalReceivedMinor)}
                </span>
              </div>
              <div className="rounded border p-3 bg-muted/40">
                <span className="text-xs text-muted-foreground block">Возвраты (Refunds)</span>
                <span className="text-lg font-extrabold text-amber-600" data-testid="report-total-refunded">
                  {formatCents(dailyPaymentReport.totalRefundedMinor)}
                </span>
              </div>
              <div className="rounded border p-3 bg-muted/40">
                <span className="text-xs text-muted-foreground block">Чистый итог за день</span>
                <span className="text-lg font-extrabold text-foreground" data-testid="report-net-received">
                  {formatCents(dailyPaymentReport.netReceivedMinor)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
              <div className="rounded border p-2 flex justify-between items-center">
                <span className="text-muted-foreground">Неоплаченные балансы клиентов:</span>
                <span className="font-semibold" data-testid="report-unpaid-balances">
                  {dailyPaymentReport.unpaidBalancesCount} ({formatCents(dailyPaymentReport.unpaidBalancesTotalMinor)})
                </span>
              </div>
              <div className="rounded border p-2 flex justify-between items-center">
                <span className="text-muted-foreground">Процедуры без оплаты:</span>
                <span className="font-semibold" data-testid="report-missing-payments">
                  {dailyPaymentReport.missingPaymentsCount} ({formatCents(dailyPaymentReport.missingPaymentsTotalMinor)})
                </span>
              </div>
              <div className="rounded border p-2 flex justify-between items-center">
                <span className="text-muted-foreground">Ожидаемый задаток (Acconto):</span>
                <span className="font-semibold" data-testid="report-pending-acconto">
                  {dailyPaymentReport.pendingAccontoCount} ({formatCents(dailyPaymentReport.pendingAccontoTotalMinor)})
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grid of Subsystem Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: System Health & Database */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>База данных (PostgreSQL)</span>
              <Badge variant={readiness.database.status === "connected" ? "outline" : "destructive"}>
                {readiness.database.status === "connected" ? "Доступна" : "Ошибка"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Задержка (ping):</span>
              <span className="font-semibold">{readiness.database.latencyMs} мс</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Миграция (Head):</span>
              <span className="text-xs font-mono">{readiness.database.migrationHead || "0037"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Worker Heartbeat:</span>
              <span className="text-xs font-medium">
                {readiness.workerHeartbeat ? `${readiness.workerHeartbeat.status} (${readiness.workerHeartbeat.ageSeconds}с назад)` : "idle"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Outbox Worker & Queue */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Очередь Outbox</span>
              <Badge variant={outbox.outboxLagSeconds > 300 || outbox.failedDeadCount > 0 ? "destructive" : "outline"}>
                {outbox.failedDeadCount > 0 ? `${outbox.failedDeadCount} сбоев` : "В норме"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ожидает (Pending):</span>
              <span className="font-semibold">{outbox.pendingCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Лаг обработки:</span>
              <span className={`font-semibold ${outbox.outboxLagSeconds > 60 ? "text-amber-600" : ""}`}>
                {outbox.outboxLagSeconds} сек
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Обработано за 24ч:</span>
              <span className="font-semibold">{outbox.completedRecentlyCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Automations */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Автоматизации</span>
              <Badge variant={automations.failedCount > 0 ? "destructive" : "outline"}>
                {automations.failedCount > 0 ? `${automations.failedCount} ошибок` : "В норме"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Запланировано:</span>
              <span className="font-semibold">{automations.scheduledCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Успешно:</span>
              <span className="font-semibold">{automations.succeededCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Просрочено:</span>
              <span className="font-semibold">{automations.oldestOverdueSeconds} сек</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Google Calendar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Google Calendar</span>
              <Badge variant={googleCalendar.needsReauthCount > 0 ? "destructive" : "outline"}>
                {googleCalendar.needsReauthCount > 0 ? "Нужна авторизация" : "В норме"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Подключено:</span>
              <span className="font-semibold">{googleCalendar.connectedCount} / {googleCalendar.totalConnections}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ошибок синхронизации:</span>
              <span className="font-semibold">{googleCalendar.syncFailuresCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Конфликтов:</span>
              <span className="font-semibold">{googleCalendar.syncConflictsCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Second row: AI & Handoffs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 5: AI Copilot Observability */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span>AI Copilot & Guardrails</span>
              <span className="text-xs text-muted-foreground">Всего запусков: {ai.runsTotal}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Успешно</span>
                <span className="text-base font-bold text-emerald-600">{ai.successCount}</span>
              </div>
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Сбои</span>
                <span className="text-base font-bold text-destructive">{ai.failureCount}</span>
              </div>
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Guardrail Rejections</span>
                <span className="text-base font-bold text-amber-600">{ai.guardrailRejectionCount}</span>
              </div>
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Ср. задержка</span>
                <span className="text-base font-bold">{ai.avgLatencyMs} мс</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground pt-1">
              <span>Токены: вход {ai.tokenUsage.inputTokens}, выход {ai.tokenUsage.outputTokens}</span>
              <span>Провайдер недоступен: {ai.providerUnavailableCount}</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 6: Handoffs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center justify-between">
              <span>Очередь передач (Handoffs)</span>
              <span className="text-xs text-muted-foreground">Активных: {handoffs.activeCount}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">В работе</span>
                <span className="text-base font-bold">{handoffs.activeCount}</span>
              </div>
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Просрочено</span>
                <span className="text-base font-bold text-destructive">{handoffs.overdueCount}</span>
              </div>
              <div className="rounded border p-2 text-center">
                <span className="text-xs text-muted-foreground block">Завершено</span>
                <span className="text-base font-bold text-emerald-600">{handoffs.completedCount}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section: Stuck & Failed Jobs Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Задачи требующие внимания ({outbox.stuckJobs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {outbox.stuckJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              Нет зависших задач или сбоев в обработке очереди.
            </p>
          ) : (
            <div className="space-y-3">
              {outbox.stuckJobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{job.handler}</span>
                      <Badge variant="outline" className="text-xs">
                        {job.state}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        Причина: {job.reason}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ID: {job.id} · Попыток: {job.attempts}/{job.maxAttempts}
                      {job.lastError && (
                        <span className="text-destructive ml-2">Ошибка: {job.lastError}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <RetryJobButton id={job.id} type="outbox" label="Повторить задачу" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
