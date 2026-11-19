"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  Radio,
  Server,
  Lock,
  ArrowRight,
  Info,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DEFAULT_WABA_ID,
  DEFAULT_TARGET_APP_ID,
  type WhatsAppDiagnosticStatusResponse,
  type WhatsAppSubscribeApiResponse,
} from "../domain/types";

interface WhatsAppDiagnosticsProps {
  isOwnerOrAdmin: boolean;
}

export function WhatsAppDiagnostics({ isOwnerOrAdmin }: WhatsAppDiagnosticsProps) {
  const [diagnostic, setDiagnostic] = useState<WhatsAppDiagnosticStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [lastActionResult, setLastActionResult] = useState<WhatsAppSubscribeApiResponse | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const fetchDiagnostic = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/admin/diagnostics/whatsapp", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const rawMsg =
          errorData?.error?.message ||
          errorData?.error ||
          `HTTP ${res.status}: Не удалось получить статус диагностики`;
        setErrorMessage(typeof rawMsg === "string" ? rawMsg : JSON.stringify(rawMsg));
        return;
      }

      const data: WhatsAppDiagnosticStatusResponse = await res.json();
      setDiagnostic(data);
      setLastCheckedAt(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось связаться с сервером диагностики";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const res = await fetch("/api/admin/diagnostics/whatsapp", {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        });

        if (!active) return;

        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          const rawMsg =
            errorData?.error?.message ||
            errorData?.error ||
            `HTTP ${res.status}: Не удалось получить статус диагностики`;
          setErrorMessage(typeof rawMsg === "string" ? rawMsg : JSON.stringify(rawMsg));
          return;
        }

        const data: WhatsAppDiagnosticStatusResponse = await res.json();
        if (!active) return;
        setDiagnostic(data);
        setLastCheckedAt(new Date());
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Не удалось связаться с сервером диагностики";
        setErrorMessage(msg);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      active = false;
    };
  }, []);

  const handleSubscribe = async () => {
    setIsSubscribing(true);
    try {
      const res = await fetch("/api/admin/diagnostics/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ confirm: true }),
      });

      const data: WhatsAppSubscribeApiResponse = await res.json().catch(() => ({
        tokenConfigured: false,
        graphApiSuccess: false,
        subscribed: false,
        appSubscribed: false,
        verified: false,
        wabaId: DEFAULT_WABA_ID,
        targetAppId: DEFAULT_TARGET_APP_ID,
        error: { message: `HTTP ${res.status}: Ошибка при обработке ответа сервера` },
      }));

      setLastActionResult(data);

      if (res.ok && data.graphApiSuccess && data.subscribed) {
        toast.success("Подписка WhatsApp Webhooks успешно оформлена!");
      } else {
        const errorMsg =
          data?.error?.message ||
          (typeof data?.error === "string" ? data.error : null) ||
          "Не удалось оформить подписку на вебхуки WhatsApp";
        toast.error(errorMsg);
      }

      // Refresh diagnostic status after subscription
      await fetchDiagnostic();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка при отправке запроса на подписку";
      toast.error(msg);
    } finally {
      setIsSubscribing(false);
      setIsDialogOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="bg-sand/20 border-borderSoft">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sand text-taupe">
                <Radio className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Диагностика WhatsApp WABA</CardTitle>
                <CardDescription>
                  Проверка доступности Meta Graph API и подписки приложения к WhatsApp Business Account
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDiagnostic}
              disabled={isLoading || isSubscribing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Проверка..." : "Обновить статус"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Metrics Grid */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Token Status */}
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Токен доступа</span>
                  </div>
                  {isLoading && !diagnostic ? (
                    <Badge variant="outline" className="animate-pulse">Проверка...</Badge>
                  ) : diagnostic?.tokenConfigured ? (
                    <Badge className="bg-emerald-600/10 text-emerald-700 border-emerald-300">
                      Настроен
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-600/10 text-amber-700 border-amber-300">
                      Отсутствует
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  WHATSAPP_ACCESS_TOKEN на сервере
                </p>
              </CardContent>
            </Card>

            {/* Graph API Connection */}
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Meta Graph API</span>
                  </div>
                  {isLoading && !diagnostic ? (
                    <Badge variant="outline" className="animate-pulse">Проверка...</Badge>
                  ) : diagnostic?.graphApiSuccess ? (
                    <Badge className="bg-emerald-600/10 text-emerald-700 border-emerald-300">
                      Доступно (v27.0)
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-600/10 text-rose-700 border-rose-300">
                      Ошибка соединения
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Ответ от graph.facebook.com
                </p>
              </CardContent>
            </Card>

            {/* Webhook Subscription */}
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Подписка WABA</span>
                  </div>
                  {isLoading && !diagnostic ? (
                    <Badge variant="outline" className="animate-pulse">Проверка...</Badge>
                  ) : diagnostic?.appSubscribed ? (
                    <Badge className="bg-emerald-600/10 text-emerald-700 border-emerald-300">
                      Подписано (Активно)
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-600/10 text-amber-700 border-amber-300">
                      Не подписано
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Регистрация в GET /subscribed_apps
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Integration Parameters Summary */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <h4 className="text-sm font-medium text-foreground">Параметры интеграции WhatsApp</h4>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="flex justify-between items-center bg-card p-3 rounded-md border">
                <span className="text-muted-foreground">WABA ID:</span>
                <code className="font-mono text-xs font-semibold">{DEFAULT_WABA_ID}</code>
              </div>
              <div className="flex justify-between items-center bg-card p-3 rounded-md border">
                <span className="text-muted-foreground">Meta App ID:</span>
                <code className="font-mono text-xs font-semibold">{DEFAULT_TARGET_APP_ID}</code>
              </div>
            </div>
            {lastCheckedAt && (
              <p className="text-xs text-muted-foreground">
                Последняя проверка: {lastCheckedAt.toLocaleTimeString()}
              </p>
            )}
          </div>

          {/* Diagnostic Error Banner (if any) */}
          {(errorMessage || diagnostic?.error) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Ошибка диагностики</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>{errorMessage || diagnostic?.error?.message || "Неизвестная ошибка Meta API"}</p>
                {diagnostic?.error?.code && (
                  <p className="text-xs opacity-90">
                    Код ошибки: {diagnostic.error.code}
                    {diagnostic.error.subcode ? ` (subcode: ${diagnostic.error.subcode})` : ""}
                    {diagnostic.error.type ? ` · Тип: ${diagnostic.error.type}` : ""}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Last Action Result Banner (if user performed a subscription action) */}
          {lastActionResult && (
            <Alert className={lastActionResult.graphApiSuccess && lastActionResult.subscribed ? "border-emerald-300 bg-emerald-50/50 text-emerald-900" : "border-rose-300 bg-rose-50/50 text-rose-900"}>
              {lastActionResult.graphApiSuccess && lastActionResult.subscribed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-600" />
              )}
              <AlertTitle className="font-medium">
                {lastActionResult.graphApiSuccess && lastActionResult.subscribed
                  ? "Результат операции: Подписка успешно выполнена"
                  : "Результат операции: Не удалось завершить подписку"}
              </AlertTitle>
              <AlertDescription className="mt-2 space-y-1 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
                  <div>POST Graph API: <span className="font-bold">{lastActionResult.graphApiSuccess ? "OK" : "FAILED"}</span></div>
                  <div>Подписка: <span className="font-bold">{lastActionResult.subscribed ? "YES" : "NO"}</span></div>
                  <div>Верификация: <span className="font-bold">{lastActionResult.verified ? "VERIFIED" : "UNVERIFIED"}</span></div>
                  <div>В списке WABA: <span className="font-bold">{lastActionResult.appSubscribed ? "YES" : "NO"}</span></div>
                </div>
                {lastActionResult.error?.message && (
                  <p className="pt-2 text-rose-700">{lastActionResult.error.message}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            <span>Действие выполняется только по подтверждению администратора и защищено CSRF.</span>
          </div>

          {/* Subscription Action Button (Restricted to OWNER / ADMIN) */}
          {isOwnerOrAdmin ? (
            <Button
              onClick={() => setIsDialogOpen(true)}
              disabled={isLoading || isSubscribing}
              className="gap-2 bg-taupe hover:bg-taupe/90 text-white"
            >
              <Radio className="h-4 w-4" />
              Subscribe WhatsApp Webhooks
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
              <Info className="h-3.5 w-3.5" />
              <span>Действие доступно только для ролей OWNER и ADMIN.</span>
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-lg">
              <Radio className="h-5 w-5 text-taupe" />
              Подтверждение подписки WhatsApp WABA
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 pt-2 text-sm text-foreground/80">
              <p>
                Вы собираетесь отправить запрос на подписку приложения к событиям WhatsApp Business Account (WABA).
              </p>
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">WABA ID:</span>
                  <span className="font-semibold text-foreground">{DEFAULT_WABA_ID}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Meta App ID:</span>
                  <span className="font-semibold text-foreground">{DEFAULT_TARGET_APP_ID}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Эндпоинт:</span>
                  <span className="font-semibold text-foreground">POST /v27.0/{DEFAULT_WABA_ID}/subscribed_apps</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                После оформления подписки CRM начнет получать вебхуки сообщений и статусов WhatsApp. Секретные токены и учетные данные не передаются через браузер.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 sm:gap-0">
            <AlertDialogCancel disabled={isSubscribing}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSubscribe();
              }}
              disabled={isSubscribing}
              className="gap-2 bg-taupe hover:bg-taupe/90 text-white"
            >
              {isSubscribing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Подписка...
                </>
              ) : (
                <>
                  <span>Подтвердить и подписать</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
