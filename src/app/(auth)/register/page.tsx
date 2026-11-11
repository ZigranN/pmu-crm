import Link from "next/link";
import { RegisterForm } from "@/features/auth/components/register-form";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-cream px-4 py-8">
      <div className="w-full flex justify-end max-w-md">
        <Link
          href="/privacy"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Правовая информация
        </Link>
      </div>

      <div className="w-full max-w-md flex justify-center my-auto">
        <RegisterForm />
      </div>

      <footer className="w-full max-w-md text-center text-xs text-muted-foreground flex justify-center gap-4 pt-4">
        <Link href="/privacy" className="hover:underline">Конфиденциальность</Link>
        <span>•</span>
        <Link href="/terms" className="hover:underline">Условия</Link>
        <span>•</span>
        <Link href="/data-deletion" className="hover:underline">Удаление данных</Link>
      </footer>
    </div>
  );
}
