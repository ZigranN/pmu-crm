import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { studioMembers, user } from "@/db/schema";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { listConversations } from "@/features/conversations/server/queries";
import { getOrCreateClientConversation } from "@/features/conversations/server/service";
import { ConversationsInbox } from "@/features/conversations/components/conversations-inbox";

interface ConversationsPageProps {
  searchParams: Promise<{
    id?: string;
    clientId?: string;
  }>;
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  let context;
  try {
    context = await requireBrowserStudioPermission("CONVERSATION_READ");
  } catch {
    redirect("/dashboard");
  }

  const params = await searchParams;
  let targetSelectedId = params.id ?? null;

  // If clientId is provided in URL, ensure conversation exists and select it
  if (params.clientId && !targetSelectedId) {
    try {
      const conv = await getOrCreateClientConversation(
        db,
        { studioId: context.studioId, userId: context.userId },
        params.clientId
      );
      targetSelectedId = conv.id;
    } catch {
      // Ignored if client not found or forbidden
    }
  }

  const conversationsList = await listConversations(context.studioId).catch((error) => {
    console.error("[Conversations Page Error]", error);
    return [];
  });

  const staff = await db
    .select({
      id: user.id,
      name: user.name,
    })
    .from(studioMembers)
    .innerJoin(user, eq(user.id, studioMembers.userId))
    .where(
      and(
        eq(studioMembers.studioId, context.studioId),
        eq(studioMembers.isActive, true)
      )
    );

  const formattedStaff = staff.map((s) => ({
    id: s.id,
    name: s.name || "Сотрудник",
  }));

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Диалоги</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Единая хронология клиентских сообщений и внутренних заметок студии
        </p>
      </div>

      <ConversationsInbox
        initialConversations={conversationsList}
        staffMembers={formattedStaff}
        initialSelectedId={targetSelectedId}
      />
    </div>
  );
}
