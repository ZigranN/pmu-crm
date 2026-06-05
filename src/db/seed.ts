import { config } from "dotenv";
config({ path: ".env.local" });

import * as schema from "./schema";
import { getSeedEnv, getDbEnv } from "@/lib/env";
import { PERMISSIONS } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as relations from "./relations";

async function main() {
  const seedEnv = getSeedEnv();

  const dbEnv = getDbEnv();
    console.log("SEED DB:", process.env.DATABASE_URL);

    const client = postgres(dbEnv.DATABASE_URL);
  const db = drizzle(client, {

    schema: { ...schema, ...relations }
  });

  console.log("🌱 Seeding database...");

  // 1. Студия
  const [studio] = await db
    .insert(schema.studios)
    .values({
      name: seedEnv.SEED_STUDIO_NAME,
      slug: seedEnv.SEED_STUDIO_SLUG,
      timezone: seedEnv.SEED_STUDIO_TIMEZONE,
      country: seedEnv.SEED_STUDIO_COUNTRY,
      city: seedEnv.SEED_STUDIO_CITY,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.studios.slug,
      set: {
        name: seedEnv.SEED_STUDIO_NAME,
        timezone: seedEnv.SEED_STUDIO_TIMEZONE,
        country: seedEnv.SEED_STUDIO_COUNTRY,
        city: seedEnv.SEED_STUDIO_CITY,
      },
    })
    .returning();

  if (!studio) {
    throw new Error("Failed to create/find studio");
  }

  console.log(`✅ Studio ready: ${studio.name}`);

  // 2. Роли
  const roleValues = Object.values(ROLES).map((code) => ({
    code: code as string,
    name: code.replace("_", " "),
    isSystem: true,
  }));

  await db
    .insert(schema.roles)
    .values(roleValues)
    .onConflictDoNothing();

  const allRoles = await db.query.roles.findMany();
  console.log(`✅ Roles ready: ${allRoles.length}`);

  // 3. Пермишены
  const permissionValues = Object.values(PERMISSIONS).map((code) => ({
    code: code as string,
    name: code.replace("_", " ").toLowerCase(),
  }));

  await db
    .insert(schema.permissions)
    .values(permissionValues)
    .onConflictDoNothing();

  const allPermissions = await db.query.permissions.findMany();
  console.log(`✅ Permissions ready: ${allPermissions.length}`);

  // 4. Пермишены для ролей
  const adminRole = allRoles.find((r) => r.code === ROLES.STUDIO_ADMIN);
  const masterRole = allRoles.find((r) => r.code === ROLES.MASTER);
  const assistantRole = allRoles.find((r) => r.code === ROLES.ASSISTANT);

  if (adminRole) {
    // STUDIO_ADMIN получает все пермишены
    const adminPerms = allPermissions.map((p) => ({
      roleId: adminRole.id,
      permissionId: p.id,
    }));
    await db.insert(schema.rolePermissions).values(adminPerms).onConflictDoNothing();
    console.log("✅ Assigned all permissions to STUDIO_ADMIN");
  }

  if (masterRole) {
    const masterPermCodes = [
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
    const masterPerms = allPermissions
      .filter((p) => masterPermCodes.includes(p.code))
      .map((p) => ({
        roleId: masterRole.id,
        permissionId: p.id,
      }));
    await db.insert(schema.rolePermissions).values(masterPerms).onConflictDoNothing();
    console.log("✅ Assigned permissions to MASTER");
  }

  if (assistantRole) {
    const assistantPermCodes = [
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
    const assistantPerms = allPermissions
      .filter((p) => assistantPermCodes.includes(p.code))
      .map((p) => ({
        roleId: assistantRole.id,
        permissionId: p.id,
      }));
    await db.insert(schema.rolePermissions).values(assistantPerms).onConflictDoNothing();
    console.log("✅ Assigned permissions to ASSISTANT");
  }

  // 5. Initial Admin Membership
  const adminUser = await db.query.user.findFirst({
    where: eq(schema.user.email, seedEnv.SEED_ADMIN_EMAIL),
  });

  if (adminUser) {
    console.log(`✅ Admin user found: ${seedEnv.SEED_ADMIN_EMAIL}`);
    if (adminRole) {
      await db
        .insert(schema.studioMembers)
        .values({
          studioId: studio.id,
          userId: adminUser.id,
          roleId: adminRole.id,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [schema.studioMembers.studioId, schema.studioMembers.userId],
          set: {
            roleId: adminRole.id,
            isActive: true,
          },
        });
      console.log(`✅ Admin membership ready: ${ROLES.STUDIO_ADMIN}`);
    }
  } else {
    console.log(`⚠️ Admin user NOT found: ${seedEnv.SEED_ADMIN_EMAIL}`);
    console.log(`👉 Please register first at /register with ${seedEnv.SEED_ADMIN_EMAIL}, then run npm run db:seed again.`);
  }

  // 6. Услуги (опционально)
  if (studio) {
    const serviceValues = [
      { name: "Sopracciglia — Sfumatura", category: "brows", procedureType: "brows", priceCents: 35000, durationMinutes: 150 },
      { name: "Labbra — Acquarello", category: "lips", procedureType: "lips", priceCents: 40000, durationMinutes: 180 },
      { name: "Occhi — Infracigliare", category: "eyes", procedureType: "eyes", priceCents: 25000, durationMinutes: 120 },
    ].map(s => ({
        ...s,
        studioId: studio.id,
        isActive: true,
    }));
    
    await db.insert(schema.services).values(serviceValues as any).onConflictDoNothing();
    console.log("✅ Services ready");
  }

  console.log("Login email for development:", seedEnv.SEED_ADMIN_EMAIL);
  console.log("🌱 Seeding finished!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seeding failed!");
  console.error(err);
  process.exit(1);
});
