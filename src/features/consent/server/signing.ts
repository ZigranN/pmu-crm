import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import {
  catalogZones,
  clients,
  commandReceipts,
  consentTemplateVersions,
  cycleConsents,
  cycleConsentZones,
  media,
  studios,
} from "@/db/schema";
import { entityId, type Transaction } from "@/server/commands/ownership";
import { lockCycle, type CycleContext } from "@/features/treatment-cycles/server/scope";
import { lockStudioAccess } from "@/server/auth/scopes";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
import { writeAudit } from "@/server/services/audit-log.service";
import { payloadHash, type Json } from "@/server/commands/idempotency";
import { generateConsentPdf, computePdfSha256 } from "./pdf";
import {
  createCycleConsentDraftSchema,
  signCycleConsentSchema,
  type CreateCycleConsentDraftInput,
  type SignCycleConsentInput,
} from "../schemas/signing.schema";

export type ConsentSignContext = CycleContext;

export const consentSigningService = {
  /**
   * Creates a draft cycle consent evidence record and attaches requested procedure zones.
   */
  async createDraft(
    tx: Transaction,
    context: ConsentSignContext,
    rawInput: CreateCycleConsentDraftInput
  ) {
    entityId.parse(context.studioId);
    const input = createCycleConsentDraftSchema.parse(rawInput);

    // 1. Authorize and lock TreatmentCycle
    const cycle = await lockCycle(tx, context, input.cycleId);

    // 2. Load template version and verify it is published
    const [templateVersion] = await tx
      .select()
      .from(consentTemplateVersions)
      .where(
        and(
          eq(consentTemplateVersions.id, input.templateVersionId),
          eq(consentTemplateVersions.studioId, context.studioId)
        )
      )
      .for("share");

    if (!templateVersion) {
      throw new Error("Consent template version not found");
    }

    if (!templateVersion.publishedAt) {
      throw new Error("Cannot create cycle consent from an unpublished draft template");
    }

    // 3. Verify all requested zones exist in the catalog
    for (const zoneCode of input.zoneCodes) {
      const [zone] = await tx
        .select({ code: catalogZones.code })
        .from(catalogZones)
        .where(eq(catalogZones.code, zoneCode));
      if (!zone) {
        throw new Error(`Catalog zone ${zoneCode} does not exist`);
      }
    }

    // 4. Insert draft cycle consent
    const [draft] = await tx
      .insert(cycleConsents)
      .values({
        studioId: context.studioId,
        cycleId: cycle.id,
        clientId: cycle.clientId,
        templateVersionId: templateVersion.id,
        status: "DRAFT",
        createdById: context.userId,
      })
      .returning();

    // 5. Insert cycle consent zones
    for (const zoneCode of input.zoneCodes) {
      await tx.insert(cycleConsentZones).values({
        studioId: context.studioId,
        consentId: draft.id,
        zoneCode,
      });
    }

    return draft;
  },

  /**
   * Atomically finalizes and signs a cycle consent.
   * Generates exact legal PDF, captures signature evidence, stores authenticated media,
   * hashes bytes with SHA-256, seals immutable SIGNED consent, and writes audit evidence.
   */
  async signConsent(
    context: ConsentSignContext,
    rawInput: SignCycleConsentInput,
    requestKey?: string
  ) {
    entityId.parse(context.studioId);
    const input = signCycleConsentSchema.parse(rawInput);

    const commandName = "cycle_consent.sign.v1";
    let hash: string | null = null;
    if (requestKey) {
      z.string().uuid().parse(requestKey);
      hash = payloadHash(input as unknown as Json);
    }

    // Step A: Load draft consent and check idempotency receipt
    const prepData = await db.transaction(async (tx) => {
      // Check command receipt if requestKey is provided
      if (requestKey && hash) {
        const [receipt] = await tx
          .select()
          .from(commandReceipts)
          .where(
            and(
              eq(commandReceipts.studioId, context.studioId),
              eq(commandReceipts.actorId, context.userId),
              eq(commandReceipts.command, commandName),
              eq(commandReceipts.requestKey, requestKey)
            )
          );

        if (receipt) {
          if (receipt.payloadHash !== hash) {
            throw new Error("Ключ запроса уже использован с другими данными");
          }
          const resultObj = receipt.result as { id: string };
          const [found] = await tx
            .select()
            .from(cycleConsents)
            .where(
              and(
                eq(cycleConsents.id, resultObj.id),
                eq(cycleConsents.studioId, context.studioId)
              )
            );
          if (!found || found.status !== "SIGNED") {
            throw new Error("Signed cycle consent not found or not sealed");
          }
          return { isReplay: true as const, consent: found };
        }
      }

      const [consent] = await tx
        .select()
        .from(cycleConsents)
        .where(
          and(
            eq(cycleConsents.id, input.consentId),
            eq(cycleConsents.studioId, context.studioId)
          )
        )
        .for("update");

      if (!consent) {
        throw new Error("Cycle consent draft not found");
      }

      // Idempotency check: if already signed, return existing
      if (consent.status === "SIGNED") {
        return { isReplay: true as const, consent };
      }

      // Lock cycle and verify access
      const cycle = await lockCycle(tx, context, consent.cycleId);

      // Verify client identity provenance
      if (consent.clientId !== cycle.clientId) {
        throw new Error("Consent client does not match current cycle client");
      }

      // Load published template version
      const [templateVersion] = await tx
        .select()
        .from(consentTemplateVersions)
        .where(
          and(
            eq(consentTemplateVersions.id, consent.templateVersionId),
            eq(consentTemplateVersions.studioId, context.studioId)
          )
        )
        .for("share");

      if (!templateVersion || !templateVersion.publishedAt) {
        throw new Error("Consent template version is unpublished or inaccessible");
      }

      // Load covered zones and verify cycle's actual zone is covered
      const coveredZones = await tx
        .select({ zoneCode: cycleConsentZones.zoneCode })
        .from(cycleConsentZones)
        .where(
          and(
            eq(cycleConsentZones.consentId, consent.id),
            eq(cycleConsentZones.studioId, context.studioId)
          )
        );

      const zoneCodes = coveredZones.map((z) => z.zoneCode);
      if (zoneCodes.length === 0) {
        throw new Error("Consent draft has no associated procedure zones");
      }

      if (!zoneCodes.includes(cycle.zoneCode)) {
        throw new Error(`Cycle procedure zone (${cycle.zoneCode}) is not covered by this consent`);
      }

      const [client] = await tx
        .select({ id: clients.id, fullName: clients.fullName })
        .from(clients)
        .where(eq(clients.id, cycle.clientId));

      const [studio] = await tx
        .select({ id: studios.id, name: studios.name })
        .from(studios)
        .where(eq(studios.id, context.studioId));

      return {
        isReplay: false as const,
        consent,
        cycle,
        templateVersion,
        client,
        studio,
      };
    });

    if (prepData.isReplay) {
      return prepData.consent;
    }

    const { consent, cycle, templateVersion, client, studio } = prepData;

    // Step B: Generate exact PDF and compute authoritative SHA-256
    const signedAt = new Date();
    const pdfBuffer = generateConsentPdf({
      studioId: context.studioId,
      studioName: studio?.name,
      clientId: cycle.clientId,
      clientName: client?.fullName,
      signatoryName: input.signatoryName.trim(),
      signatoryRole: input.signatoryRole,
      cycleId: cycle.id,
      zoneCode: cycle.zoneCode,
      templateId: templateVersion.templateId,
      templateVersionId: templateVersion.id,
      versionNumber: templateVersion.versionNumber,
      templateTitle: templateVersion.title,
      templateBody: templateVersion.body,
      signedAt,
      signatureMethod: input.signatureMethod,
      signaturePayload: input.signaturePayload,
    });

    const signedPdfSha256 = computePdfSha256(pdfBuffer);

    // Step C: Upload PDF to authenticated private storage
    const resource_type = "raw";
    const pdfFile = new File([new Uint8Array(pdfBuffer)], "signed_consent.pdf", {
      type: "application/pdf",
    });
    const { url, publicId } = await uploadToCloudinary(pdfFile, {
      folder: `crm-pmu/${context.studioId}/consent`,
      resource_type,
      type: "authenticated",
    });

    // Step D: Atomically seal signed consent and persist media row
    try {
      return await db.transaction(async (tx) => {
        await lockStudioAccess(tx, context);

        // Re-lock consent inside mutation transaction
        const [lockedConsent] = await tx
          .select()
          .from(cycleConsents)
          .where(
            and(
              eq(cycleConsents.id, consent.id),
              eq(cycleConsents.studioId, context.studioId)
            )
          )
          .for("update");

        if (!lockedConsent) {
          throw new Error("Cycle consent not found");
        }

        if (lockedConsent.status === "SIGNED") {
          return lockedConsent;
        }

        // Lock cycle to ensure no concurrent mutations
        await lockCycle(tx, context, consent.cycleId);

        // Insert media row
        const [mediaRecord] = await tx
          .insert(media)
          .values({
            studioId: context.studioId,
            clientId: cycle.clientId,
            type: "consent",
            url,
            publicId: publicId || null,
            caption: templateVersion.title,
            createdById: context.userId,
          })
          .returning();

        // Finalize cycle consent to SIGNED
        const finalizedAt = new Date();
        const [signedConsent] = await tx
          .update(cycleConsents)
          .set({
            status: "SIGNED",
            mediaId: mediaRecord.id,
            signedPdfSha256,
            signatureMethod: input.signatureMethod,
            signaturePayload: input.signaturePayload,
            signatoryName: input.signatoryName.trim(),
            signatoryRole: input.signatoryRole,
            signedAt,
            finalizedById: context.userId,
            finalizedAt,
          })
          .where(
            and(
              eq(cycleConsents.id, consent.id),
              eq(cycleConsents.studioId, context.studioId)
            )
          )
          .returning();

        // Write audit log
        await writeAudit(tx, {
          studioId: context.studioId,
          userId: context.userId,
          action: "cycle_consent_signed",
          entityType: "cycle_consent",
          entityId: signedConsent.id,
          before: { status: "DRAFT" },
          after: {
            status: "SIGNED",
            mediaId: mediaRecord.id,
            signedPdfSha256,
            signatoryName: signedConsent.signatoryName,
            signatoryRole: signedConsent.signatoryRole,
            signatureMethod: signedConsent.signatureMethod,
            signedAt: signedConsent.signedAt?.toISOString(),
            finalizedAt: signedConsent.finalizedAt?.toISOString(),
          },
          reason: "command:cycle_consent_signed",
          metadata: {
            cycleId: cycle.id,
            templateVersionId: templateVersion.id,
          },
        });

        // Insert command receipt if requestKey provided
        if (requestKey && hash) {
          const commandId = randomUUID();
          await tx.insert(commandReceipts).values({
            id: commandId,
            studioId: context.studioId,
            actorId: context.userId,
            command: commandName,
            requestKey,
            payloadHash: hash,
            result: {
              id: signedConsent.id,
              cycleId: signedConsent.cycleId,
              clientId: signedConsent.clientId,
              templateVersionId: signedConsent.templateVersionId,
              status: signedConsent.status,
              mediaId: signedConsent.mediaId,
              signedPdfSha256: signedConsent.signedPdfSha256,
              signedAt: signedConsent.signedAt?.toISOString(),
              finalizedAt: signedConsent.finalizedAt?.toISOString(),
            },
          });
        }

        return signedConsent;
      });
    } catch (error) {
      // Compensating deletion of uploaded asset on DB transaction failure
      if (publicId) {
        try {
          await deleteFromCloudinary(publicId, {
            resource_type: "raw",
            type: "authenticated",
          });
        } catch {
          console.error("Compensating Cloudinary cleanup failed", { publicId });
        }
      }
      throw error;
    }
  },
};
