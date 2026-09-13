import { getCycleBoard } from "@/features/treatment-cycles/server/queries";
import { CycleBoard } from "@/features/treatment-cycles/components/cycle-board";
export default async function DealsPage() {return <CycleBoard data={await getCycleBoard()} />;}
