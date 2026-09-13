"use client";
import { useState } from "react";
import Link from "next/link";
import type { DuplicateReview, DuplicateDecision } from "../server/deduplication";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function DuplicateReviewPanel({ review, canConfirm, pending, onConfirm }: { review: DuplicateReview; canConfirm: boolean; pending: boolean; onConfirm: (decision: DuplicateDecision) => void }) {
  const [reason, setReason] = useState("");
  return <section className="rounded border p-4 space-y-3" aria-label="Проверка совпадений">
    <h2 className="font-semibold">Возможные дубли</h2>
    <p>Совпадение контакта не доказывает, что это один человек. Проверьте карточки: общий семейный номер допускается с объяснением.</p>
    {review.truncated && <p role="alert">Слишком много кандидатов. Уточните имя и контакты перед созданием.</p>}
    {!review.candidates.length && !review.truncated && <p>Совпадений среди доступных карточек не найдено.</p>}
    <ul className="space-y-3">{review.candidates.map(row => <li className="rounded border p-3 break-words" key={row.id}>
      <p className="font-medium">{row.fullName}{row.archived ? " · Архив" : ""}</p>
      <p>{row.level === "exact" ? "Точное совпадение контакта" : "Возможное совпадение по имени"}: {row.reasons.join(", ")}</p>
      <p>{row.phone}{row.whatsapp && row.whatsapp !== row.phone ? ` · WhatsApp: ${row.whatsapp}` : ""}</p>
      {row.email && <p>{row.email}</p>}{row.instagram && <p>Instagram: {row.instagram}</p>}
      {!row.archived && <Link href={`/clients/${row.id}`} className="underline">Открыть карточку</Link>}
      {row.archived && <p className="text-sm">Архивную запись нужно проверить перед созданием новой.</p>}
    </li>)}</ul>
    {canConfirm && !!review.candidates.length && !review.truncated && <div className="space-y-2">
      <label htmlFor="duplicate-reason">Почему это отдельный клиент</label><Input id="duplicate-reason" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} disabled={pending} />
      <Button className="h-auto w-full whitespace-normal py-3" type="button" disabled={pending || reason.trim().length < 3} onClick={() => onConfirm({ token: review.token, reason })}>Подтверждаю: создать отдельную карточку</Button>
    </div>}
  </section>;
}
