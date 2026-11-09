import { requireBrowserStudioContext, requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";
import { listHandoffs } from "@/features/handoffs/server/queries";
import { getStaffMembersAction } from "@/features/handoffs/server/actions";
import { HandoffsQueue } from "@/features/handoffs/components/handoffs-queue";

export default async function HandoffsPage() {
  try {
    await requireBrowserStudioPermission("HANDOFF_READ");
  } catch {
    redirect("/dashboard");
  }

  const context = await requireBrowserStudioContext();
  const items = await listHandoffs();
  const staff = await getStaffMembersAction();

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
      <HandoffsQueue
        initialItems={items}
        staffMembers={staff}
        currentUserId={context.userId}
      />
    </div>
  );
}
