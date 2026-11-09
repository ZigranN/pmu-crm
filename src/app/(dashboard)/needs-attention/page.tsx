import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";
import { getNeedsAttention } from "@/features/needs-attention/server/queries";
import { NeedsAttentionDashboard } from "@/features/needs-attention/components/needs-attention-dashboard";

export default async function NeedsAttentionPage() {
  try {
    await requireBrowserStudioPermission("CLIENT_READ");
  } catch {
    redirect("/dashboard");
  }

  const items = await getNeedsAttention();

  return <NeedsAttentionDashboard initialItems={items} />;
}
