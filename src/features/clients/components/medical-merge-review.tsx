"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeMedicalMergeReview } from "@/features/medical/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
export function MedicalMergeReview({ clientId, updatedAt }: { clientId: string; updatedAt: string }) {
  const [reason,setReason] = useState(""); const [busy,setBusy] = useState(false); const router = useRouter();
  return <div className="space-y-2 rounded border p-3"><label htmlFor="medical-merge-review">Результат проверки исторических медицинских сведений</label><Input id="medical-merge-review" value={reason} onChange={event=>setReason(event.target.value)} maxLength={1000} disabled={busy} />
    <Button type="button" className="h-auto whitespace-normal" disabled={busy || reason.trim().length < 3} onClick={async()=>{setBusy(true);try {await acknowledgeMedicalMergeReview(clientId,reason,updatedAt);router.refresh();}catch{toast.error("Не удалось сохранить проверку");}finally{setBusy(false);}}}>Подтверждаю проверку исторических сведений</Button><p className="text-sm">Подтверждение не является медицинским допуском к процедуре.</p></div>;
}
