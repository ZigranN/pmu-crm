"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createCycleAction } from "../server/actions";
import { CYCLE_STAGES } from "../schemas/cycle.schema";
import { STAGE_LABELS, ZONE_LABELS, type CycleStage } from "../stages";
import type { getCycleBoard } from "../server/queries";
type Board=Awaited<ReturnType<typeof getCycleBoard>>;
export function CycleBoard({data}:{data:Board}) {
  const router=useRouter(),[pending,start]=useTransition(),[error,setError]=useState("");
  const [stage,setStage]=useState("all");
  const request=useRef<{payload:string;key:string}|null>(null);
  function create(form:FormData) {
    const input={clientId:String(form.get("client")),zoneCode:String(form.get("zone")) as "brows"|"eyes"|"lips",reason:String(form.get("reason"))};
    const payload=JSON.stringify(input);if(request.current?.payload!==payload) request.current={payload,key:crypto.randomUUID()};
    const key=request.current.key;
    start(async()=>{setError("");try {const result=await createCycleAction(input,key);router.push(`/deals/${result.id}`);}catch(e){setError(e instanceof Error?e.message:"Не удалось создать цикл");}});
  }
  return <div className="space-y-5"><h1 className="text-2xl font-bold">Циклы процедур</h1><p>Одна зона — отдельный цикл. Статус карточки клиента хранится отдельно.</p>
    {data.truncated&&<p role="alert">Показаны первые 500 циклов и клиентов.</p>}
    {data.canWrite&&<form onSubmit={event=>{event.preventDefault();create(new FormData(event.currentTarget));}} className="grid gap-3 rounded border p-4">
      <h2 className="font-semibold">Новый PMU-цикл</h2>
      <label>Клиент<select required name="client" className="block w-full rounded border p-2" defaultValue=""><option value="" disabled>Выберите клиента</option>{data.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Зона<select name="zone" className="block w-full rounded border p-2"><option value="brows">Брови</option><option value="eyes">Глаза</option><option value="lips">Губы</option></select></label>
      <label>Причина создания<input name="reason" required minLength={3} maxLength={1000} className="block w-full rounded border p-2" /></label>
      <Button disabled={pending||!data.clients.length} type="submit">Создать цикл</Button>
    </form>}
    {error&&<p role="alert">{error}</p>}
    <label>Стадия<select value={stage} onChange={e=>setStage(e.target.value)} className="block w-full rounded border p-2"><option value="all">Все стадии</option>{CYCLE_STAGES.map(s=><option key={s} value={s}>{STAGE_LABELS[s]} ({data.rows.filter(r=>r.stage===s).length})</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.rows.filter(r=>stage==="all"||r.stage===stage).map(r=><Link key={r.id} href={`/deals/${r.id}`} className="min-w-0 break-words rounded border p-4 hover:bg-sand/30"><h2 className="font-semibold">{r.name} · {ZONE_LABELS[r.zone]??r.zone}</h2><p>{STAGE_LABELS[r.stage as CycleStage]}</p></Link>)}</div>
    {!data.rows.length&&<p>Циклов пока нет.</p>}
  </div>;
}
