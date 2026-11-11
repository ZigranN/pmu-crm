import Link from "next/link";
import { ShieldCheck, FileText, Trash2, ArrowLeft, Building2 } from "lucide-react";
import React from "react";

interface LegalPageShellProps {
  title: string;
  subtitle: string;
  lastUpdated?: string;
  activePath: "/privacy" | "/terms" | "/data-deletion";
  children: React.ReactNode;
}

export function LegalPageShell({
  title,
  subtitle,
  lastUpdated = "11 ноября 2026 г.",
  activePath,
  children,
}: LegalPageShellProps) {
  const navItems = [
    { href: "/privacy", label: "Политика конфиденциальности", icon: ShieldCheck },
    { href: "/terms", label: "Условия использования", icon: FileText },
    { href: "/data-deletion", label: "Удаление данных Meta", icon: Trash2 },
  ];

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2B211B] flex flex-col font-sans selection:bg-[#E6DCD2]">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#FAF7F2]/90 backdrop-blur-md border-b border-[#E6DCD2]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/login"
              className="flex items-center space-x-2 text-[#2B211B] hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-lg bg-[#2B211B] text-[#FAF7F2] flex items-center justify-center font-bold text-sm tracking-wider">
                PMU
              </div>
              <span className="font-semibold text-lg tracking-tight">PMU CRM</span>
            </Link>
            <span className="hidden sm:inline-block text-xs px-2.5 py-0.5 rounded-full bg-[#F4EEE7] text-[#8B6F5A] border border-[#E6DCD2] font-medium">
              Legal & Compliance
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium px-3.5 py-1.5 rounded-lg bg-[#2B211B] text-[#FAF7F2] hover:bg-[#3D3027] transition-colors shadow-sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Войти в CRM
            </Link>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex overflow-x-auto gap-2 py-2 border-t border-[#E6DCD2]/60 scrollbar-none text-xs sm:text-sm">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap transition-colors font-medium ${
                  isActive
                    ? "bg-[#8B6F5A] text-white shadow-xs"
                    : "text-[#7A6A5F] hover:text-[#2B211B] hover:bg-[#F4EEE7]"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Placeholder banner */}
        <div className="mb-6 p-4 rounded-xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-xs sm:text-sm leading-relaxed flex items-start gap-3">
          <Building2 className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Сведения для согласования юридическим лицом:</span>
            Фрагменты в квадратных скобках вида <code className="bg-amber-100/80 px-1.5 py-0.5 rounded text-amber-950 font-mono text-xs">[Наименование организации]</code> содержат реквизиты и параметры, подлежащие согласованию и заполнению владельцем студии или оператором сервиса.
          </div>
        </div>

        {/* Title Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-[#2B211B] mb-2">
            {title}
          </h1>
          <p className="text-sm sm:text-base text-[#7A6A5F] max-w-3xl leading-relaxed">
            {subtitle}
          </p>
          <div className="mt-3 text-xs text-[#8B6F5A] font-medium">
            Дата последней редакции: {lastUpdated}
          </div>
        </div>

        {/* Document Card */}
        <article className="bg-white rounded-2xl border border-[#E6DCD2] p-6 sm:p-10 shadow-xs space-y-8 leading-relaxed text-[#2B211B] text-sm sm:text-base">
          {children}
        </article>
      </main>

      {/* Footer */}
      <footer className="bg-[#F4EEE7] border-t border-[#E6DCD2] py-8 text-xs text-[#7A6A5F]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-[#2B211B]">PMU CRM</span>
            <span>— специализированная CRM-платформа для студий перманентного макияжа</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/privacy" className="hover:text-[#2B211B] underline-offset-4 hover:underline">
              Конфиденциальность
            </Link>
            <Link href="/terms" className="hover:text-[#2B211B] underline-offset-4 hover:underline">
              Условия
            </Link>
            <Link href="/data-deletion" className="hover:text-[#2B211B] underline-offset-4 hover:underline">
              Удаление данных
            </Link>
            <Link href="/login" className="hover:text-[#2B211B] underline-offset-4 hover:underline">
              Вход
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
