import { requireBrowserStudioContext } from "@/server/auth/context";
import { getInstagramConnections } from "@/features/instagram/server/service";
import { InstagramSettings } from "@/features/instagram/components/instagram-settings";
import { db } from "@/db";
import { studios } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function InstagramSettingsPage() {
  const context = await requireBrowserStudioContext();
  const isOwnerOrAdmin =
    context.role === "OWNER" ||
    context.role === "ADMIN" ||
    context.role === "SUPER_ADMIN" ||
    context.role === "STUDIO_ADMIN";

  const [connections, studio] = await Promise.all([
    getInstagramConnections(context.studioId),
    db
      .select({ instagram: studios.instagram })
      .from(studios)
      .where(eq(studios.id, context.studioId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-taupe">Instagram Direct</h1>
        <p className="text-muted-foreground text-sm">
          Управление интеграцией с Meta Unified Login / Instagram Messaging
        </p>
      </div>

      <InstagramSettings
        connections={connections}
        isOwnerOrAdmin={isOwnerOrAdmin}
        studioInstagramHandle={studio?.instagram}
      />
    </div>
  );
}
