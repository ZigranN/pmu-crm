"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { getCycleTimeline } from "../server/queries";
import { transitionCycleAction } from "../server/actions";
import { STAGE_LABELS, ZONE_LABELS, type CycleStage } from "../stages";
export function CycleTimeline({data}:{data:Awaited<ReturnType<typeof getCycleTimeline>>}) {
  const router=useRouter(),[pending,start]=useTransition(),[error,setError]=useState("");
  const request=useRef<{payload:string;key:string}|null>(null);
  const [to,setTo]=useState("");
  const selected=data.choices.find(choice=>choice.to===to);
  function transition(form:FormData) {
    const input={id:data.id,expectedVersion:data.version,to:to as CycleStage,reason:String(form.get("reason"))};
    const payload=JSON.stringify(input);if(request.current?.payload!==payload) request.current={payload,key:crypto.randomUUID()};const key=request.current.key;
    start(async()=>{setError("");try {await transitionCycleAction(input,key);setTo("");router.refresh();}catch(e){setError(e instanceof Error?e.message:"Не удалось изменить стадию");}});
  }
  return <div className="space-y-4"><Link href="/deals">← Все циклы</Link><h1 className="text-2xl font-bold break-words">Цикл: {data.name}</h1>
    <p>Зона: {ZONE_LABELS[data.zone]??data.zone} · Версия: {data.version}</p><p>Стадия: <strong>{STAGE_LABELS[data.stage as CycleStage]}</strong></p><Link href={`/clients/${data.clientId}`}>Карточка клиента</Link>
    {data.canWrite&&data.choices.length>0&&<form onSubmit={event=>{event.preventDefault();transition(new FormData(event.currentTarget));}} className="grid gap-3 rounded border p-4">
      <label>Следующая стадия<select required value={to} onChange={e=>setTo(e.target.value)} className="block w-full rounded border p-2"><option value="">Выберите стадию</option>{data.choices.map(choice=><option key={choice.to} value={choice.to}>{STAGE_LABELS[choice.to]}</option>)}</select></label>
      {to==="consultation_needed"&&<p>Если мастер цикла ещё не выбран, будет использовано назначение из карточки клиента. Существующее назначение цикла сохраняется.</p>}
      {selected?.blocked&&<p role="status">{selected.blocked}</p>}
      <label>Причина перехода<input name="reason" required minLength={3} maxLength={1000} className="block w-full rounded border p-2" /></label>
      <Button disabled={pending||!selected||Boolean(selected.blocked)}>Изменить стадию</Button>
    </form>}
    {error&&<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>router.refresh()}>Обновить данные</Button></div>}
    <h2 className="text-lg font-semibold">История цикла</h2>{data.truncated&&<p>Показаны последние 1000 событий.</p>}
    {!data.history.length&&<p>Истории команд пока нет. Старые события не восстанавливаются автоматически.</p>}
    <ol className="space-y-3">{data.history.map(row=><li key={row.id} className="rounded border p-3 break-words"><p>{row.fromStage?STAGE_LABELS[row.fromStage as CycleStage]+" → ":"Создание → "}{STAGE_LABELS[row.toStage as CycleStage]}</p><p>{row.reason}</p><p className="text-sm text-muted-foreground">{new Date(row.createdAt).toISOString()} · Версия {row.version} · {row.actorName??"Пользователь недоступен"}</p></li>)}</ol>
  </div>;
}
