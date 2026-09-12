import { db } from "./index";
import * as s from "./schema";
import { getSeedEnv } from "@/lib/env";
import { PERMISSIONS } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";
import { eq, and, inArray, isNull, asc, sql } from "drizzle-orm";

export const demoServices = [
  { seedKey: "demo:brows-shading", name: "Sopracciglia — Sfumatura", category: "brows", procedureType: "brows", priceCents: 35000, durationMinutes: 150 },
  { seedKey: "demo:lips-watercolor", name: "Labbra — Acquarello", category: "lips", procedureType: "lips", priceCents: 40000, durationMinutes: 180 },
  { seedKey: "demo:eyes-lashline", name: "Occhi — Infracigliare", category: "eyes", procedureType: "eyes", priceCents: 25000, durationMinutes: 120 },
] satisfies Array<Omit<typeof s.services.$inferInsert, "studioId">>;

// Legacy role defaults, not the final Phase 1 role/assignment policy.
const masterCodes = [
      "CLIENT_READ", "CLIENT_CREATE", "CLIENT_UPDATE",
      "MEDICAL_PROFILE_READ", "MEDICAL_PROFILE_UPDATE",
      "SERVICE_READ",
      "MASTER_READ",
      "APPOINTMENT_READ", "APPOINTMENT_CREATE", "APPOINTMENT_UPDATE", "APPOINTMENT_CANCEL", "APPOINTMENT_COMPLETE", "APPOINTMENT_NO_SHOW",
      "PROCEDURE_READ", "PROCEDURE_CREATE", "PROCEDURE_UPDATE",
      "MEDIA_READ", "MEDIA_CREATE",
      "CONSENT_READ", "CONSENT_UPLOAD",
      "PAYMENT_MARK_DEPOSIT",
      "WHATSAPP_TEMPLATE_READ", "WHATSAPP_TEMPLATE_USE",
      "TASK_READ", "TASK_CREATE", "TASK_UPDATE",
      "REVIEW_READ", "REVIEW_CREATE",
      "ANALYTICS_READ"
    ];
const assistantCodes = [
      "CLIENT_READ", "CLIENT_CREATE", "CLIENT_UPDATE",
      "MEDICAL_PROFILE_READ",
      "APPOINTMENT_READ", "APPOINTMENT_CREATE", "APPOINTMENT_UPDATE", "APPOINTMENT_CANCEL",
      "MEDIA_READ", "MEDIA_CREATE",
      "CONSENT_READ", "CONSENT_UPLOAD",
      "PAYMENT_MARK_DEPOSIT",
      "WHATSAPP_TEMPLATE_READ", "WHATSAPP_TEMPLATE_USE",
      "TASK_READ", "TASK_CREATE", "TASK_UPDATE",
      "REVIEW_READ", "REVIEW_CREATE"
    ];

export async function seedDatabase(settings: ReturnType<typeof getSeedEnv>) {
  return db.transaction(async (tx) => {
    // Serialize bootstrap operations, including adoption of legacy demo rows.
    await tx.execute(sql`select pg_advisory_xact_lock(7342105)`);
    await tx.insert(s.studios).values({ name: settings.SEED_STUDIO_NAME, slug: settings.SEED_STUDIO_SLUG,
      timezone: settings.SEED_STUDIO_TIMEZONE, country: settings.SEED_STUDIO_COUNTRY, city: settings.SEED_STUDIO_CITY,
      address: settings.SEED_STUDIO_ADDRESS, whatsappNumber: settings.SEED_STUDIO_WHATSAPP,
    }).onConflictDoNothing({ target: s.studios.slug });
    const studio = await tx.query.studios.findFirst({ where: eq(s.studios.slug, settings.SEED_STUDIO_SLUG) });
    if (!studio) throw new Error("Studio bootstrap failed");

    await tx.insert(s.roles).values(Object.values(ROLES).map((code) => ({ code, name: code.replaceAll("_", " "), isSystem: true }))).onConflictDoNothing();
    await tx.insert(s.permissions).values(Object.values(PERMISSIONS).map((code) => ({ code, name: code.replaceAll("_", " ").toLowerCase() }))).onConflictDoNothing();
    const roles = await tx.select().from(s.roles).where(inArray(s.roles.code, Object.values(ROLES)));
    const permissions = await tx.select().from(s.permissions).where(inArray(s.permissions.code, Object.values(PERMISSIONS)));
    for (const role of roles) {
      const codes = role.code === ROLES.STUDIO_ADMIN ? Object.values(PERMISSIONS)
        : role.code === ROLES.MASTER ? masterCodes : role.code === ROLES.ASSISTANT ? assistantCodes : [];
      const grants = permissions.filter((permission) => codes.includes(permission.code)).map((permission) => ({ roleId: role.id, permissionId: permission.id }));
      if (grants.length) await tx.insert(s.rolePermissions).values(grants).onConflictDoNothing({ target: [s.rolePermissions.roleId, s.rolePermissions.permissionId] });
    }
    const admin = await tx.query.user.findFirst({ where: eq(s.user.email, settings.SEED_ADMIN_EMAIL) });
    const adminRole = roles.find((role) => role.code === ROLES.STUDIO_ADMIN);
    if (admin && adminRole) {
      // Do not reactivate or promote an existing membership on a seed rerun.
      await tx.insert(s.studioMembers).values({ studioId: studio.id, userId: admin.id, roleId: adminRole.id, isActive: true })
        .onConflictDoNothing({ target: [s.studioMembers.studioId, s.studioMembers.userId] });
    }
    if (settings.SEED_DEMO_SERVICES === "true") {
      for (const demo of demoServices) {
        const seeded = await tx.query.services.findFirst({ where: and(eq(s.services.studioId, studio.id), eq(s.services.seedKey, demo.seedKey)) });
        if (seeded) continue; // Keep edited prices/names and archived state.
        const legacy = await tx.select().from(s.services).where(and(eq(s.services.studioId, studio.id), eq(s.services.name, demo.name), isNull(s.services.seedKey)))
          .orderBy(asc(s.services.createdAt), asc(s.services.id)).limit(2);
        if (legacy.length > 1) throw new Error("Ambiguous legacy demo services; resolve duplicates before enabling demo seed");
        if (legacy.length) {
          await tx.update(s.services).set({ seedKey: demo.seedKey }).where(eq(s.services.id, legacy[0].id));
        } else {
          await tx.insert(s.services).values({ ...demo, studioId: studio.id });
        }
      }
    }
    return { studioId: studio.id, adminLinked: !!admin && !!adminRole, demoEnabled: settings.SEED_DEMO_SERVICES === "true" };
  });
}
