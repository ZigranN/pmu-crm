"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { roles, studioMembers, user } from "@/db/schema";
import { requireBrowserStudioContext } from "@/server/auth/context";
import { idempotentCommand } from "@/server/commands/idempotency";
import {
  acceptHandoffSchema,
  cancelHandoffSchema,
  completeHandoffSchema,
  createHandoffSchema,
  rejectHandoffSchema,
  type AcceptHandoffInput,
  type CancelHandoffInput,
  type CompleteHandoffInput,
  type CreateHandoffInput,
  type RejectHandoffInput,
} from "../schemas/handoff.schema";
import {
  acceptHandoff,
  cancelHandoff,
  completeHandoff,
  createHandoff,
  rejectHandoff,
} from "./service";
import { getHandoff, listHandoffs } from "./queries";
import type { HandoffFilters } from "../domain/types";

export async function createHandoffAction(input: CreateHandoffInput) {
  const parsed = createHandoffSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = {
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      clientId: parsed.clientId ?? null,
      cycleId: parsed.cycleId ?? null,
      conversationId: parsed.conversationId ?? null,
      appointmentId: parsed.appointmentId ?? null,
      fromUserId: parsed.fromUserId ?? context.userId,
      toUserId: parsed.toUserId,
      sourceType: parsed.sourceType,
      reasonCode: parsed.reasonCode,
      reasonText: parsed.reasonText ?? null,
      priority: parsed.priority,
      dueAt: parsed.dueAt ? parsed.dueAt.toISOString() : null,
    };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "HANDOFF_CREATE",
      "handoff.create.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await createHandoff(
          tx,
          { studioId: context.studioId, userId: context.userId },
          parsed
        );
        return {
          ...res,
          createdAt: res.createdAt.toISOString(),
          updatedAt: res.updatedAt.toISOString(),
          dueAt: res.dueAt ? res.dueAt.toISOString() : null,
          acceptedAt: res.acceptedAt ? res.acceptedAt.toISOString() : null,
          rejectedAt: res.rejectedAt ? res.rejectedAt.toISOString() : null,
          completedAt: res.completedAt ? res.completedAt.toISOString() : null,
          cancelledAt: res.cancelledAt ? res.cancelledAt.toISOString() : null,
        } as any;
      },
      async () => {}
    );

    revalidatePath("/handoffs");
    revalidatePath("/needs-attention");
    revalidatePath("/conversations");
    if (parsed.clientId) revalidatePath(`/clients/${parsed.clientId}`);

    return {
      ...serialized,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
      dueAt: serialized.dueAt ? new Date(serialized.dueAt) : null,
      acceptedAt: serialized.acceptedAt ? new Date(serialized.acceptedAt) : null,
      rejectedAt: serialized.rejectedAt ? new Date(serialized.rejectedAt) : null,
      completedAt: serialized.completedAt ? new Date(serialized.completedAt) : null,
      cancelledAt: serialized.cancelledAt ? new Date(serialized.cancelledAt) : null,
    };
  }

  const res = await createHandoff(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/handoffs");
  revalidatePath("/needs-attention");
  revalidatePath("/conversations");
  if (parsed.clientId) revalidatePath(`/clients/${parsed.clientId}`);

  return res;
}

export async function acceptHandoffAction(input: AcceptHandoffInput) {
  const parsed = acceptHandoffSchema.parse(input);
  const context = await requireBrowserStudioContext();

  if (parsed.requestKey) {
    const payload = { handoffId: parsed.handoffId };

    const serialized = await idempotentCommand<any>(
      { studioId: context.studioId, userId: context.userId },
      "HANDOFF_ACCEPT",
      "handoff.accept.v1",
      parsed.requestKey,
      payload as any,
      async (tx) => {
        const res = await acceptHandoff(
          tx,
          { studioId: context.studioId, userId: context.userId },
          parsed
        );
        return {
          ...res,
          createdAt: res.createdAt.toISOString(),
          updatedAt: res.updatedAt.toISOString(),
          dueAt: res.dueAt ? res.dueAt.toISOString() : null,
          acceptedAt: res.acceptedAt ? res.acceptedAt.toISOString() : null,
          rejectedAt: res.rejectedAt ? res.rejectedAt.toISOString() : null,
          completedAt: res.completedAt ? res.completedAt.toISOString() : null,
          cancelledAt: res.cancelledAt ? res.cancelledAt.toISOString() : null,
        } as any;
      },
      async () => {}
    );

    revalidatePath("/handoffs");
    revalidatePath("/needs-attention");
    revalidatePath("/conversations");
    return {
      ...serialized,
      createdAt: new Date(serialized.createdAt),
      updatedAt: new Date(serialized.updatedAt),
      dueAt: serialized.dueAt ? new Date(serialized.dueAt) : null,
      acceptedAt: serialized.acceptedAt ? new Date(serialized.acceptedAt) : null,
      rejectedAt: serialized.rejectedAt ? new Date(serialized.rejectedAt) : null,
      completedAt: serialized.completedAt ? new Date(serialized.completedAt) : null,
      cancelledAt: serialized.cancelledAt ? new Date(serialized.cancelledAt) : null,
    };
  }

  const res = await acceptHandoff(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/handoffs");
  revalidatePath("/needs-attention");
  revalidatePath("/conversations");
  return res;
}

export async function rejectHandoffAction(input: RejectHandoffInput) {
  const parsed = rejectHandoffSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await rejectHandoff(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/handoffs");
  revalidatePath("/needs-attention");
  revalidatePath("/conversations");
  return res;
}

export async function cancelHandoffAction(input: CancelHandoffInput) {
  const parsed = cancelHandoffSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await cancelHandoff(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/handoffs");
  revalidatePath("/needs-attention");
  revalidatePath("/conversations");
  return res;
}

export async function completeHandoffAction(input: CompleteHandoffInput) {
  const parsed = completeHandoffSchema.parse(input);
  const context = await requireBrowserStudioContext();

  const res = await completeHandoff(
    db,
    { studioId: context.studioId, userId: context.userId },
    parsed
  );

  revalidatePath("/handoffs");
  revalidatePath("/needs-attention");
  revalidatePath("/conversations");
  return res;
}

export async function listHandoffsAction(filters?: HandoffFilters) {
  return listHandoffs(filters);
}

export async function getHandoffAction(id: string) {
  return getHandoff(id);
}

export async function getStaffMembersAction() {
  const context = await requireBrowserStudioContext();

  const members = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      roleCode: roles.code,
      roleName: roles.name,
    })
    .from(studioMembers)
    .innerJoin(user, eq(studioMembers.userId, user.id))
    .innerJoin(roles, eq(studioMembers.roleId, roles.id))
    .where(
      and(
        eq(studioMembers.studioId, context.studioId),
        eq(studioMembers.isActive, true),
        ne(roles.code, "CLIENT"),
        ne(roles.code, "AI_SYSTEM")
      )
    );

  return members;
}
