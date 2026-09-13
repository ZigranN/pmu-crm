"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { recoverJob } from "../server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function RecoveryButton({ id, uncertain }: { id: string; uncertain: boolean }) {
  const [reason, setReason] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  return <form className="mt-3 space-y-2" onSubmit={async event => {
    event.preventDefault(); if (pending) return; setPending(true); setError("");
    try { await recoverJob({ id, reason }); setReason(""); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Ошибка восстановления"); }
    finally { setPending(false); }
  }}>
    <Input aria-label="Причина восстановления" value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} required />
    <Button disabled={pending} type="submit">{uncertain ? "Проверить результат отправки" : "Повторить обработку"}</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </form>;
}
