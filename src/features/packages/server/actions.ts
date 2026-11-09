"use server";

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { masters, treatmentCycles, treatmentPackages } from "@/db/schema";
import { requireBrowserStudioPermission } from "@/server/auth/context";
import { lockClient } from "@/server/commands/ownership";
import { idempotentCommand } from "@/server/commands/idempotency";
import { recordCycleEvidence } from "@/features/treatment-cycles/server/mutation";
import { writeAudit } from "@/server/services/audit-log.service";
import { TOTAL_FACE_SUPPORTED_ZONES } from "../domain/types";

const createTotalFacePackageSchema = z.object({
  clientId: z.string().uuid(),
  zoneCodes: z
    .array(z.enum(TOTAL_FACE_SUPPORTED_ZONES))
    .min(1)
    .max(3)
    .default(["brows", "eyes", "lips"])
    .refine((zones) => new Set(zones).size === zones.length, {
      message: "Зоны в пакете не должны дублироваться",
    }),
  reason: z.string().trim().min(3).max(1000),
}).strict();

const completeTotalFacePackageSchema = z.object({
  packageId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export async function createTotalFacePackageAction(
  input: z.infer<typeof createTotalFacePackageSchema>,
  requestKey: string
) {
  const data = createTotalFacePackageSchema.parse(input);
  const context = await requireBrowserStudioPermission("CLIENT_UPDATE");

  const result = await idempotentCommand(
    context,
    "CLIENT_UPDATE",
    "total-face.create.v1",
    requestKey,
    data,
    async (tx, commandId) => {
      const client = await lockClient(
        tx,
        data.clientId,
        context.studioId,
        context.userId,
        false,
        "CLIENT_UPDATE"
      );

      if (client.assignedMasterId) {
        const [master] = await tx
          .select({ id: masters.id })
          .from(masters)
          .where(
            and(
              eq(masters.id, client.assignedMasterId),
              eq(masters.studioId, context.studioId),
              eq(masters.isActive, true),
              isNull(masters.deletedAt)
            )
          );
        if (!master) throw new Error("Назначенный мастер недоступен");
      }

      const [pkg] = await tx
        .insert(treatmentPackages)
        .values({
          studioId: context.studioId,
          clientId: client.id,
          kind: "total_face",
          status: "active",
          createdById: context.userId,
        })
        .returning();

      const createdCycles: Array<typeof treatmentCycles.$inferSelect> = [];
      const cycleIds: string[] = [];

      for (const zoneCode of data.zoneCodes) {
        const [cycle] = await tx
          .insert(treatmentCycles)
          .values({
            studioId: context.studioId,
            clientId: client.id,
            zoneCode,
            kind: "pmu",
            stage: "new_lead",
            packageId: pkg.id,
            assignedMasterId: client.assignedMasterId,
          })
          .returning();

        await recordCycleEvidence(
          tx,
          context,
          commandId,
          null,
          cycle,
          data.reason,
          "cycle_created",
          "user"
        );
        createdCycles.push(cycle);
        cycleIds.push(cycle.id);
      }

      await writeAudit(tx, {
        ...context,
        action: "total_face_package_created",
        entityType: "treatment_package",
        entityId: pkg.id,
        before: null,
        after: {
          clientId: pkg.clientId,
          kind: pkg.kind,
          status: pkg.status,
          createdById: pkg.createdById,
          cycleIds,
        },
        reason: data.reason,
        reasonSource: "user",
        metadata: { commandId },
      });

      return {
        id: pkg.id,
        version: pkg.version,
        cycleIds,
      };
    },
    async (tx, result) => {
      const [existing] = await tx
        .select()
        .from(treatmentPackages)
        .where(
          and(
            eq(treatmentPackages.id, result.id),
            eq(treatmentPackages.studioId, context.studioId)
          )
        );
      if (!existing) throw new Error("Пакет не найден");
    }
  );

  revalidatePath("/deals");
  revalidatePath(`/clients/${data.clientId}`);
  return result;
}

export async function completeTotalFacePackageAction(
  input: z.infer<typeof completeTotalFacePackageSchema>,
  requestKey: string
) {
  const data = completeTotalFacePackageSchema.parse(input);
  const context = await requireBrowserStudioPermission("CLIENT_UPDATE");

  const result = await idempotentCommand(
    context,
    "CLIENT_UPDATE",
    "total-face.complete.v1",
    requestKey,
    data,
    async (tx, commandId) => {
      const [pkg] = await tx
        .select()
        .from(treatmentPackages)
        .where(
          and(
            eq(treatmentPackages.id, data.packageId),
            eq(treatmentPackages.studioId, context.studioId)
          )
        );

      if (!pkg) throw new Error("Пакет не найден");
      if (pkg.status === "completed") {
        return { id: pkg.id, version: pkg.version, status: pkg.status };
      }
      if (pkg.status !== "active") {
        throw new Error("Пакет не в активном статусе");
      }

      const siblingCycles = await tx
        .select()
        .from(treatmentCycles)
        .where(
          and(
            eq(treatmentCycles.packageId, pkg.id),
            eq(treatmentCycles.studioId, context.studioId)
          )
        );

      if (siblingCycles.length === 0) {
        throw new Error("У пакета нет привязанных циклов");
      }

      const unfinished = siblingCycles.filter(
        (c) => c.stage !== "cycle_completed"
      );

      if (unfinished.length > 0) {
        throw new Error(
          `Невозможно завершить пакет: ${unfinished.length} циклов еще не завершены`
        );
      }

      const [updated] = await tx
        .update(treatmentPackages)
        .set({
          status: "completed",
          completedAt: new Date(),
          version: pkg.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(treatmentPackages.id, pkg.id),
            eq(treatmentPackages.version, pkg.version)
          )
        )
        .returning();

      if (!updated) throw new Error("Пакет изменён");

      await writeAudit(tx, {
        ...context,
        action: "total_face_package_completed",
        entityType: "treatment_package",
        entityId: updated.id,
        before: { status: pkg.status, version: pkg.version },
        after: {
          status: updated.status,
          version: updated.version,
          completedAt: updated.completedAt,
        },
        reason: data.reason,
        reasonSource: "user",
        metadata: { commandId },
      });

      return {
        id: updated.id,
        version: updated.version,
        status: updated.status,
      };
    },
    async (tx, result) => {
      const [existing] = await tx
        .select()
        .from(treatmentPackages)
        .where(
          and(
            eq(treatmentPackages.id, result.id),
            eq(treatmentPackages.studioId, context.studioId)
          )
        );
      if (!existing) throw new Error("Пакет не найден");
    }
  );

  revalidatePath("/deals");
  return result;
}
