import { requireBrowserStudioContext } from "@/server/auth/context";
import { WhatsAppDiagnostics } from "@/features/whatsapp/components/whatsapp-diagnostics";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "WhatsApp Diagnostics & Webhooks | PMU CRM",
  description: "Диагностика WABA и управление подпиской на вебхуки WhatsApp",
};

export default async function WhatsAppDiagnosticsPage() {
  const context = await requireBrowserStudioContext();
  const isOwnerOrAdmin =
    context.role === "OWNER" ||
    context.role === "ADMIN" ||
    context.role === "SUPER_ADMIN" ||
    context.role === "STUDIO_ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Назад к настройкам</span>
        </Link>
        <h1 className="text-2xl font-bold text-taupe">WhatsApp Webhooks & WABA</h1>
        <p className="text-muted-foreground text-sm">
          Диагностика подключения WhatsApp Cloud API и управление подпиской WABA на события вебхуков
        </p>
      </div>

      <WhatsAppDiagnostics isOwnerOrAdmin={isOwnerOrAdmin} />
    </div>
  );
}
