import { getStudioRole } from "@/lib/roles";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { getServices } from "@/features/services/server/queries";
import { ServiceList } from "@/features/services/components/service-list";
import { getSession, getCurrentStudioId } from "@/features/auth/server/actions";
import { redirect } from "next/navigation";

export default async function ServicesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const studioId = await getCurrentStudioId(session.user.id);
  if (!studioId) redirect("/dashboard");
  if (!await hasPermission(db, session.user.id, studioId, "SERVICE_READ")) redirect("/dashboard");

  const services = await getServices(studioId, { showArchived: true })
    .catch((error) => {
      console.error("[Services Page Error]", error);
      throw error;
    });

  return <ServiceList initialServices={services} canCreate={await hasPermission(db, session.user.id, studioId, "SERVICE_CREATE")} canImport={await getStudioRole(db, session.user.id, studioId) === "OWNER"} />;
}
