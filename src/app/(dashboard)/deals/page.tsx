import { getCycleBoard } from "@/features/treatment-cycles/server/queries";
import { CycleBoard } from "@/features/treatment-cycles/components/cycle-board";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

export default async function DealsPage() {
  try {
    await requireBrowserStudioPermission("CLIENT_READ");
  } catch {
    redirect("/dashboard");
  }
  return <CycleBoard data={await getCycleBoard()} />;
}
