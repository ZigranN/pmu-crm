import { getCycleTimeline } from "@/features/treatment-cycles/server/queries";
import { CycleTimeline } from "@/features/treatment-cycles/components/cycle-timeline";
export default async function DealPage({params}:{params:Promise<{id:string}>}) {const {id}=await params;return <CycleTimeline data={await getCycleTimeline(id)} />;}
