import { hasPermission } from "@/lib/permissions";
import { db } from "@/db";
import { getServices } from "@/features/services/server/queries";
import { ServiceList } from "@/features/services/components/service-list";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { redirect } from "next/navigation";

export default async function ServicesPage() {
  let context;
  try {
    context = await requireBrowserStudioPermission("SERVICE_READ");
  } catch {
    redirect("/dashboard");
  }

  const studioId = context.studioId;
  const services = await getServices(studioId, { showArchived: true })
    .catch((error) => {
      console.error("[Services Page Error]", error);
      throw error;
    });

  return (
    <ServiceList
      initialServices={services}
      canCreate={await hasPermission(db, context.userId, studioId, "SERVICE_CREATE")}
      canImport={context.role === "OWNER"}
    />
  );
}
