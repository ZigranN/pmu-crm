import { getCommercialTerms } from "@/features/commercial-terms/server/queries";
import { TermsPanel } from "@/features/commercial-terms/components/terms-panel";
import { getCycleTimeline } from "@/features/treatment-cycles/server/queries";
import { CycleTimeline } from "@/features/treatment-cycles/components/cycle-timeline";
import { getConsultationPanel } from "@/features/consultations/server/queries";
import { ConsultationPanel } from "@/features/consultations/components/result-form";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireBrowserStudioContext();
  const timeline = await getCycleTimeline(id);
  const panel = (await hasPermission(db, context.userId, context.studioId, "MEDICAL_PROFILE_READ"))
    ? await getConsultationPanel(id)
    : null;
  const terms = (await hasPermission(db, context.userId, context.studioId, "PAYMENT_READ"))
    ? await getCommercialTerms(id)
    : null;
  return (
    <div className="space-y-8">
      <CycleTimeline data={timeline} />
      {terms && <TermsPanel data={terms} />}
      {panel && <ConsultationPanel data={panel} />}
    </div>
  );
}
