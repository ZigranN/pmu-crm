import { getCycleTimeline } from "@/features/treatment-cycles/server/queries";
import { CycleTimeline } from "@/features/treatment-cycles/components/cycle-timeline";
import { getConsultationPanel } from "@/features/consultations/server/queries";
import { ConsultationPanel } from "@/features/consultations/components/result-form";
import { requireStudioContext } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
export default async function DealPage({params}:{params:Promise<{id:string}>}) {
 const {id}=await params,context=await requireStudioContext();
 const timeline=await getCycleTimeline(id);
 const panel=await hasPermission(db,context.userId,context.studioId,"MEDICAL_PROFILE_READ")?await getConsultationPanel(id):null;
 return <div className="space-y-8"><CycleTimeline data={timeline}/>{panel&&<ConsultationPanel data={panel}/>}</div>;
}
