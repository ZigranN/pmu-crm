"use client";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OUTCOMES,OUTCOME_LABELS } from "../contracts";
import { qualifyCycleAction,completeConsultationAction,recordConsultationResultAction } from "../server/results";
import type { getConsultationPanel } from "../server/queries";
export function ConsultationPanel({data}:{data:Awaited<ReturnType<typeof getConsultationPanel>>}) {
  const router=useRouter(),[pending,start]=useTransition(),[error,setError]=useState("");
  const keys=useRef(new Map<string,string>()),[outcome,setOutcome]=useState<typeof OUTCOMES[number]>("can_proceed");
  function run(command:string,payload:unknown,action:(key:string)=>Promise<unknown>){const hash=command+JSON.stringify(payload);if(!keys.current.has(hash))keys.current.set(hash,crypto.randomUUID());start(async()=>{setError("");try{await action(keys.current.get(hash)!);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить решение");}});}
  const input="block w-full rounded border p-2";
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Квалификация и консультация</h2>
    {error&&<p role="alert">{error}</p>}
    {data.currentQualification&&<p>{data.currentQualification.consultationRequired?"По актуальной проверке нужна консультация":"По актуальной проверке консультация необязательна"}. Перед записью данные будут проверены снова.</p>}
    {data.canWrite&&!data.suspended&&data.kind==="pmu"&&["qualification","consultation_needed"].includes(data.stage)&&<form className="grid gap-3 rounded border p-4" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const payload={id:data.id,expectedVersion:data.version,otherMasterPmu:form.get("otherMasterPmu")==="on",doubt:form.get("doubt")==="on",conditionChanged:form.get("conditionChanged")==="on",evaluationRequired:form.get("evaluationRequired")==="on",reason:String(form.get("reason"))};run("qualify",payload,key=>qualifyCycleAction(payload,key));}}>
      <p>Специалист проверяет исключения. Отсутствие галочки означает, что соответствующее исключение проверено и не обнаружено.</p>
      <label><input type="checkbox" name="otherMasterPmu" /> PMU другого мастера</label><label><input type="checkbox" name="doubt" /> Есть сомнение</label><label><input type="checkbox" name="conditionChanged" /> Состояние изменилось</label><label><input type="checkbox" name="evaluationRequired" /> Требуется оценка</label>
      <label>Основание квалификации<input name="reason" required minLength={3} maxLength={1000} className={input}/></label><Button disabled={pending}>Проверить квалификацию</Button>
    </form>}
    {data.canWrite&&!data.suspended&&["consultation_scheduled","consultation_confirmed","consultation_completed"].includes(data.stage)&&<form className="grid gap-3 rounded border p-4" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget),payload={id:data.id,expectedVersion:data.version,appointmentId:String(form.get("appointment")),reason:String(form.get("reason"))};run("complete",payload,key=>completeConsultationAction(payload,key));}}>
      <label htmlFor="consultation-visit">Завершённый визит</label><select id="consultation-visit" name="appointment" className={input} required defaultValue=""><option value="">Выберите визит</option>{data.visits.map(v=><option key={v.id} value={v.id}>{new Date(v.endAt).toISOString()}</option>)}</select>
      <label>Основание завершения<input name="reason" required minLength={3} maxLength={1000} className={input}/></label><Button disabled={pending||!data.visits.length}>Зафиксировать завершение консультации</Button>
    </form>}
    {data.latest&&!data.result&&<p>Ожидается решение специалиста. Срок: {new Date(data.latest.decisionDueAt).toISOString()}{data.task?". Задача создана":""}.</p>}
    {data.canWrite&&data.latest&&!data.result&&data.stage==="consultation_result_required"&&<form className="grid gap-3 rounded border p-4" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const date=String(form.get("date")??"");const payload={id:data.id,expectedVersion:data.version,consultationId:data.latest!.id,outcome,reason:String(form.get("reason")),comment:String(form.get("comment")??""),reassessmentAt:outcome==="temporarily_unavailable"&&date?new Date(date).toISOString():null};run("result",payload,key=>recordConsultationResultAction(payload,key));}}>
      <label htmlFor="consultation-outcome">Результат консультации</label><select id="consultation-outcome" value={outcome} onChange={e=>setOutcome(e.target.value as typeof outcome)} className={input}>{OUTCOMES.map(o=><option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}</select>
      <label>Причина решения<input name="reason" required minLength={3} maxLength={1000} className={input}/></label><label>Комментарий специалиста<textarea name="comment" maxLength={2000} required={outcome==="temporarily_unavailable"} className={input}/></label>
      {outcome==="temporarily_unavailable"&&<label>Повторная оценка (время вашего устройства)<input type="datetime-local" name="date" required className={input}/></label>}
      <Button disabled={pending}>Сохранить решение</Button>
    </form>}
    {data.result&&<div className="rounded border p-4 break-words"><h3>{OUTCOME_LABELS[data.result.outcome as typeof OUTCOMES[number]]}</h3><p>{data.result.reason}</p><p>{data.result.comment}</p>{data.result.removerCycleId&&<a className="underline" href={`/deals/${data.result.removerCycleId}`}>Связанный Remover-цикл</a>}{data.result.reassessmentAt&&<p>Повторная оценка: {new Date(data.result.reassessmentAt).toISOString()}</p>}{data.result.followUpAt&&<p>Следующий контакт: {new Date(data.result.followUpAt).toISOString()}</p>}</div>}
    {!data.canWrite&&<p>Решения записывает специалист с соответствующим доступом.</p>}
  </section>;
}
