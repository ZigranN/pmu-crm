import { OUTCOMES } from "@/features/consultations/contracts";
import { CYCLE_STAGES, CYCLE_KINDS } from "@/features/treatment-cycles/schemas/cycle.schema";
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    pgEnum,
    jsonb,
    uuid,
    index,
    uniqueIndex,
    check,
    foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { AUDIT_ENTITIES, ACCESS_OPERATIONS, type AuditAction } from "@/lib/audit-contract";

// --- Enums ---

export const userRoleEnum = pgEnum("user_role", [
  "SUPER_ADMIN",
  "STUDIO_ADMIN",
  "MASTER",
  "ASSISTANT",
  "CLIENT",
]);

export const permissionEffectEnum = pgEnum("permission_effect", ["allow", "deny"]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

export const appointmentSourceEnum = pgEnum("appointment_source", [
  "whatsapp",
  "instagram",
  "phone",
  "walk_in",
  "referral",
  "returning_client",
  "other",
]);

export const appointmentEventTypeEnum = pgEnum("appointment_event_type", [
  "created",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
  "payment_added",
  "deposit_added",
  "admin_overlap_override",
]);

export const serviceCategoryEnum = pgEnum("service_category", [
  "brows",
  "lips",
  "eyes",
  "total_look",
  "consultation",
  "correction",
  "refresh",
  "facial",
  "remover",
  "cover_up",
  "lamination",
  "skin",
  "other",
]);

export const procedureAreaEnum = pgEnum("procedure_area", [
  "brows",
  "lips",
  "eyes",
  "total_look",
  "skin",
  "lash_brow_lamination",
  "other",
]);

export const procedureTypeEnum = pgEnum("procedure_type", [
  "brows",
  "lips",
  "eyes",
  "total_look",
  "correction",
  "refresh",
  "consultation",
  "remover",
  "cover_up",
  "lamination",
  "facial",
  "other",
]);

export const sessionTypeEnum = pgEnum("session_type", [
  "consultation",
  "primary_session",
  "second_session",
  "correction",
  "refresh",
  "control",
  "cover_up",
  "remover",
  "touch_up",
]);

export const healingStageEnum = pgEnum("healing_stage", [
  "fresh",
  "day_2_3",
  "day_7",
  "day_30",
  "healed",
  "needs_correction",
  "completed",
]);

export const procedureNextStepEnum = pgEnum("procedure_next_step", [
  "book_second_session",
  "book_correction",
  "wait_healing",
  "refresh_later",
  "completed",
  "contact_client",
  "control_needed",
]);

export const blockedTimeReasonEnum = pgEnum("blocked_time_reason", [
  "lunch",
  "personal",
  "vacation",
  "training",
  "repair",
  "sanitary_break",
  "other",
]);

export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", [
  "none",
  "daily",
  "weekly",
  "monthly",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card",
  "bank_transfer",
  "other",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "partial",
  "paid",
  "refunded",
]);

export const paymentTransactionTypeEnum = pgEnum("payment_transaction_type", [
  "deposit",
  "balance",
  "full_payment",
  "refund",
  "adjustment",
]);

export const mediaTypeEnum = pgEnum("media_type", [
  "before",
  "after",
  "healing_day_7",
  "healing_day_30",
  "correction",
  "refresh",
  "consent",
  "portfolio",
  "document",
  "other",
]);

export const consentTypeEnum = pgEnum("consent_type", [
  "pmu_general",
  "brows",
  "lips",
  "eyes",
  "remover",
  "facial",
  "photo_permission",
  "marketing_permission",
  "other",
]);

export const taskTypeEnum = pgEnum("task_type", [
  "follow_up",
  "correction_reminder",
  "refresh_reminder",
  "no_reply",
  "call_client",
  "payment_reminder",
  "review_request",
  "consent_missing",
  "custom",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "task_due",
  "appointment_reminder",
  "payment_balance",
  "correction_due",
  "refresh_due",
  "follow_up_due",
  "review_request_due",
  "consent_missing",
  "system",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "unread",
  "read",
  "dismissed",
  "completed",
]);

export const reviewSourceEnum = pgEnum("review_source", [
  "manual",
  "whatsapp",
  "instagram",
  "facebook",
  "other",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "draft",
  "published",
  "archived",
]);

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "client_created",
  "client_updated",
  "client_status_changed",
  "client_master_assigned",
  "client_archived",
  "client_restored",
  "medical_profile_updated",
  "appointment_created",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_completed",
  "deposit_received",
  "payment_received",
  "procedure_created",
  "pigment_added",
  "photo_uploaded",
  "consent_uploaded",
  "consent_archived",
  "task_created",
  "task_completed",
  "whatsapp_opened",
  "review_added",
]);

export const pigmentTemperatureEnum = pgEnum("pigment_temperature", [
  "warm",
  "neutral",
  "cool",
]);

export const pigmentBaseTypeEnum = pgEnum("pigment_base_type", [
  "yellow",
  "orange",
  "red",
  "pink",
  "brown",
  "black",
  "olive",
  "other",
]);

export const pigmentCompositionTypeEnum = pgEnum("pigment_composition_type", [
  "organic",
  "inorganic",
  "hybrid",
  "unknown",
]);

export const pigmentAreaRecommendedEnum = pgEnum("pigment_area_recommended", [
  "brows",
  "lips",
  "eyes",
  "areola",
  "scalp",
  "other",
]);

export const clientStatusEnum = pgEnum("client_status", [
  "new_lead",
  "contacted",
  "needs_consultation",
  "consultation_booked",
  "no_reply",
  "appointment_booked",
  "procedure_done",
  "follow_up",
  "second_session_needed",
  "correction_needed",
  "completed",
  "returning_client",
  "refresh_needed",
  "lost",
]);

export const exportTypeEnum = pgEnum("export_type", [
  "client_card",
  "client_history",
  "procedures",
  "appointments",
  "payments",
  "reviews",
]);

export const exportStatusEnum = pgEnum("export_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// --- Tables ---

// Better Auth Tables
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  phone: text("phone"),
  role: userRoleEnum("role").default("CLIENT").notNull(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// App Tables

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'STUDIO_ADMIN'
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'CLIENT_READ'
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id")
    .notNull()
    .references(() => permissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ rolePermissionUnique: uniqueIndex("role_permissions_role_permission_unique").on(table.roleId, table.permissionId) }));

export const userCustomPermissions = pgTable("user_custom_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id")
    .notNull()
    .references(() => permissions.id, { onDelete: "cascade" }),
  effect: permissionEffectEnum("effect").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ userStudioPermissionUnique: uniqueIndex("user_custom_permissions_identity_unique").on(table.userId, table.studioId, table.permissionId) }));

export const studios = pgTable("studios", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  timezone: text("timezone").default("Europe/Rome").notNull(),
  whatsappNumber: text("whatsapp_number"),
  phone: text("phone"),
  email: text("email"),
  instagram: text("instagram"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const studioMembers = pgTable(
    "studio_members",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        roleId: uuid("role_id")
            .notNull()
            .references(() => roles.id),
        isActive: boolean("is_active").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        studioUserUnique: uniqueIndex("studio_members_studio_id_user_id_unique").on(
            table.studioId,
            table.userId
        ),
    })
);

export const masters = pgTable("masters", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  displayName: text("display_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  calendarColor: text("calendar_color"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedById: text("deleted_by_id"),
}, (table) => ({ identity: uniqueIndex("masters_id_studio_unique").on(table.id, table.studioId),
  userBinding: uniqueIndex("masters_studio_user_unique").on(table.studioId, table.userId) }));

export const masterServices = pgTable(
    "master_services",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id, { onDelete: "cascade" }),
        serviceId: uuid("service_id")
            .notNull()
            .references(() => services.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        masterServiceUnique: uniqueIndex("master_services_master_id_service_id_unique").on(
            table.masterId,
            table.serviceId
        ),
        masterIdIdx: index("master_services_master_id_idx").on(table.masterId),
        serviceIdIdx: index("master_services_service_id_idx").on(table.serviceId),
    })
);

export const catalogCategories = pgTable("catalog_categories", { code: text("code").primaryKey(), label: text("label").notNull() });
export const catalogZones = pgTable("catalog_zones", { code: text("code").primaryKey(), label: text("label").notNull() });
export const catalogTechniques = pgTable("catalog_techniques", { code: text("code").primaryKey(), label: text("label").notNull() });
export const serviceDefinitions = pgTable("service_definitions", {
  code: text("code").primaryKey(), name: text("name").notNull(),
  categoryCode: text("category_code").notNull().references(() => catalogCategories.code),
  zoneCode: text("zone_code").notNull().references(() => catalogZones.code),
  techniqueCode: text("technique_code").notNull().references(() => catalogTechniques.code),
  category: serviceCategoryEnum("category").notNull(), procedureType: procedureTypeEnum("procedure_type").notNull(),
  sessionsModel: text("sessions_model").notNull(), priceMode: text("price_mode").notNull(),
  priceCents: integer("price_cents"), priceMaxCents: integer("price_max_cents"), durationMinutes: integer("duration_minutes"),
}, table => ({
  sessionKey: uniqueIndex("service_definitions_session_key").on(table.code, table.sessionsModel),
  sessionCheck: check("service_definitions_session_check", sql`${table.sessionsModel} in ('one','two','variable')
    and (${table.categoryCode} != 'pmu' or ${table.sessionsModel} = 'two') and (${table.categoryCode} != 'remover' or ${table.sessionsModel} = 'variable')`),
}));

export const services = pgTable(
    "services",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        seedKey: text("seed_key"),
        catalogVersion: integer("catalog_version").notNull().default(0),
        catalogCode: text("catalog_code").references(() => serviceDefinitions.code),
        sessionsModel: text("sessions_model"),
        priceMode: text("price_mode").notNull().default("legacy"),
        priceMaxCents: integer("price_max_cents"),
        preparationTemplateId: uuid("preparation_template_id"),
        postCareTemplateId: uuid("post_care_template_id"),
        supersededById: uuid("superseded_by_id"),
        description: text("description"),
        category: serviceCategoryEnum("category").notNull(),
        procedureType: procedureTypeEnum("procedure_type").notNull(),
        priceCents: integer("price_cents"),
        durationMinutes: integer("duration_minutes"),
        bufferBeforeMinutes: integer("buffer_before_minutes").default(0).notNull(),
        bufferAfterMinutes: integer("buffer_after_minutes").default(0).notNull(),
        requiresCorrection: boolean("requires_correction").default(false).notNull(),
        correctionAfterDays: integer("correction_after_days"),
        isActive: boolean("is_active").default(true).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        studioIdentity: uniqueIndex("services_id_studio_unique").on(table.id, table.studioId),
        catalogUnique: uniqueIndex("services_studio_catalog_unique").on(table.studioId, table.catalogCode),
        sessionFk: foreignKey({ columns: [table.catalogCode, table.sessionsModel], foreignColumns: [serviceDefinitions.code, serviceDefinitions.sessionsModel], name: "services_definition_sessions_fk" }),
        preparationFk: foreignKey({ columns: [table.preparationTemplateId, table.studioId], foreignColumns: [whatsappTemplates.id, whatsappTemplates.studioId], name: "services_preparation_studio_fk" }),
        postCareFk: foreignKey({ columns: [table.postCareTemplateId, table.studioId], foreignColumns: [whatsappTemplates.id, whatsappTemplates.studioId], name: "services_postcare_studio_fk" }),
        replacementFk: foreignKey({ columns: [table.supersededById, table.studioId], foreignColumns: [table.id, table.studioId], name: "services_replacement_studio_fk" }),
        replacementCheck: check("services_replacement_check", sql`${table.supersededById} is null or (${table.supersededById} != ${table.id} and ${table.isActive} = false and ${table.deletedAt} is not null)`),
        catalogCheck: check("services_catalog_contract_check", sql`${table.catalogVersion} = 0 or (${table.catalogVersion} = 1
          and ${table.catalogCode} is not null and ${table.sessionsModel} is not null
          and ${table.bufferBeforeMinutes} = 0 and ${table.bufferAfterMinutes} = 0
          and (${table.durationMinutes} is null or ${table.durationMinutes} between 5 and 1440)
          and (${table.isActive} = false or ${table.durationMinutes} is not null)
          and ((${table.priceMode} in ('fixed','estimate') and ${table.priceCents} is not null and ${table.priceMaxCents} is null)
            or (${table.priceMode} = 'range' and ${table.priceCents} is not null and ${table.priceMaxCents} is not null and ${table.priceMaxCents} >= ${table.priceCents})
            or (${table.priceMode} = 'master_quote' and ${table.priceCents} is null and ${table.priceMaxCents} is null)))`),
        seedKeyUnique: uniqueIndex("services_studio_seed_key_unique").on(table.studioId, table.seedKey),
        studioIdIdx: index("services_studio_id_idx").on(table.studioId),
        nameIdx: index("services_name_idx").on(table.name),
        priceCheck: check("services_price_cents_check", sql`${table.priceCents} >= 0`),
        durationCheck: check("services_duration_minutes_check", sql`${table.durationMinutes} > 0`),
    })
);


export const clients = pgTable(
    "clients",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        firstName: text("first_name").notNull(),
        lastName: text("last_name"),
        fullName: text("full_name").notNull(),
        phone: text("phone").notNull(),
        whatsapp: text("whatsapp"),
        email: text("email"),
        birthDate: timestamp("birth_date"),
        instagram: text("instagram"),
        source: text("source"),
        clientStatus: clientStatusEnum("client_status").notNull(),
        leadStatus: text("lead_status"),
        notes: text("notes"),
        tags: text("tags"),
        referredByName: text("referred_by_name"),
        interest: text("interest"),
        treatmentZone: text("treatment_zone"),
        nextContactAt: timestamp("next_contact_at"),
        campaignTag: text("campaign_tag"),
        serviceTag: text("service_tag"),
        language: text("language"),
        interestedZones: text("interested_zones").array(),
        clientKind: text("client_kind"),
        reportedPreviousPmu: boolean("reported_previous_pmu"),
        phoneKey: text("phone_key").generatedAlwaysAs(sql`pmu_phone_key(phone)`),
        whatsappKey: text("whatsapp_key").generatedAlwaysAs(sql`pmu_phone_key(whatsapp)`),
        emailKey: text("email_key").generatedAlwaysAs(sql`pmu_email_key(email)`),
        instagramKey: text("instagram_key").generatedAlwaysAs(sql`pmu_instagram_key(instagram)`),
        nameKey: text("name_key").generatedAlwaysAs(sql`pmu_name_key(full_name)`),
        mergedIntoId: uuid("merged_into_id"),
        preferredMasterId: uuid("preferred_master_id"),
        assignedMasterId: uuid("assigned_master_id"),
        ltvCents: integer("ltv_cents").default(0).notNull(),
        visitCount: integer("visit_count").default(0).notNull(),
        retentionScore: integer("retention_score"),
        firstVisitDate: timestamp("first_visit_date"),
        lastVisitDate: timestamp("last_visit_date"),
        nextVisitDate: timestamp("next_visit_date"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        mergeTarget: foreignKey({ name: "clients_merge_target_studio_fk", columns: [table.mergedIntoId, table.studioId], foreignColumns: [table.id, table.studioId] }),
        mergeCheck: check("clients_merge_check", sql`${table.mergedIntoId} is null or (${table.mergedIntoId} != ${table.id} and ${table.deletedAt} is not null)`),
        mergeIdx: index("clients_merge_target_idx").on(table.studioId, table.mergedIntoId),
        phoneKeyIdx: index("clients_studio_phone_key_idx").on(table.studioId, table.phoneKey),
        whatsappKeyIdx: index("clients_studio_whatsapp_key_idx").on(table.studioId, table.whatsappKey),
        emailKeyIdx: index("clients_studio_email_key_idx").on(table.studioId, table.emailKey),
        instagramKeyIdx: index("clients_studio_instagram_key_idx").on(table.studioId, table.instagramKey),
        nameKeyIdx: index("clients_studio_name_key_idx").on(table.studioId, table.nameKey),
        namePrefixIdx: index("clients_studio_name_prefix_idx").on(table.studioId, sql`left(${table.nameKey}, 3)`),
        preferred: foreignKey({ name: "clients_preferred_master_studio_fk", columns: [table.preferredMasterId, table.studioId], foreignColumns: [masters.id, masters.studioId] }),
        languageCheck: check("clients_language_check", sql`${table.language} is null or ${table.language} in ('it','en','ru','uk','de','fr','es','ro','pl','other')`),
        kindCheck: check("clients_kind_check", sql`${table.clientKind} is null or ${table.clientKind} in ('new','returning')`),
        interestCheck: check("clients_interested_zones_check", sql`${table.interestedZones} is null or (${table.interestedZones} <@ ARRAY['brows','eyes','lips','lashes','skin']::text[] and cardinality(${table.interestedZones}) <= 5 and array_position(${table.interestedZones}, NULL) is null)`),
        assignment: foreignKey({ name: "clients_assigned_master_studio_fk", columns: [table.assignedMasterId, table.studioId], foreignColumns: [masters.id, masters.studioId] }),
        assignmentIdx: index("clients_studio_assigned_master_idx").on(table.studioId, table.assignedMasterId),
        identity: uniqueIndex("clients_id_studio_unique").on(table.id, table.studioId),
        studioIdIdx: index("clients_studio_id_idx").on(table.studioId),
        phoneIdx: index("clients_phone_idx").on(table.phone),
        whatsappIdx: index("clients_whatsapp_idx").on(table.whatsapp),
        emailIdx: index("clients_email_idx").on(table.email),
        fullNameIdx: index("clients_full_name_idx").on(table.fullName),
    })
);

export const clientAssignments = pgTable("client_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  previousMasterId: uuid("previous_master_id"),
  masterId: uuid("master_id"),
  changedById: text("changed_by_id").notNull().references(() => user.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ clientHistory: index("client_assignments_client_history_idx").on(table.studioId, table.clientId, table.createdAt) }));

export const clientMedicalProfiles = pgTable("client_medical_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
    supersededAt: timestamp("superseded_at"),
    mergeReviewRequired: boolean("merge_review_required").notNull().default(false),
    allergies: text("allergies"),
    contraindications: text("contraindications"),
    skinType: text("skin_type"),
    pregnancyStatus: text("pregnancy_status"),
    medications: text("medications"),
    previousPMU: boolean("previous_pmu").default(false).notNull(),
    previousPMUNotes: text("previous_pmu_notes"),
    herpesHistory: boolean("herpes_history").default(false).notNull(),
    diabetes: boolean("diabetes").default(false).notNull(),
    bloodThinners: boolean("blood_thinners").default(false).notNull(),
    keloidRisk: boolean("keloid_risk").default(false).notNull(),
    autoimmuneDiseases: boolean("autoimmune_diseases").default(false).notNull(),
    recentBotoxFillers: boolean("recent_botox_fillers").default(false).notNull(),
    recentPeelingLaser: boolean("recent_peeling_laser").default(false).notNull(),
    skinSensitivity: boolean("skin_sensitivity").default(false).notNull(),
    medicalNotes: text("medical_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, table => ({ active: uniqueIndex("client_medical_active_unique").on(table.clientId).where(sql`${table.supersededAt} is null`) }));

export const medicalProfileRevisions = pgTable("medical_profile_revisions", {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
        .notNull()
        .references(() => studios.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
    clientRevisionUnique: uniqueIndex("medical_profile_revisions_client_revision_unique").on(table.clientId, table.revisionNumber),
    studioIdx: index("medical_profile_revisions_studio_idx").on(table.studioId),
    clientCreatedIdx: index("medical_profile_revisions_client_created_idx").on(table.clientId, table.createdAt),
    revisionNumberCheck: check("medical_profile_revisions_revision_positive", sql`${table.revisionNumber} > 0`),
}));


export const clientStatusHistory = pgTable("client_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedById: text("changed_by_id").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const masterAvailability = pgTable(
    "master_availability",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id, { onDelete: "cascade" }),
        weekday: integer("weekday").notNull(),
        startTime: text("start_time").notNull(),
        endTime: text("end_time").notNull(),
        isActive: boolean("is_active").default(true).notNull(),
    },
    (table) => ({
        weekdayCheck: check(
            "master_availability_weekday_check",
            sql`${table.weekday} >= 0 AND ${table.weekday} <= 6`
        ),
    })
);

export const masterBreaks = pgTable(
    "master_breaks",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id, { onDelete: "cascade" }),
        weekday: integer("weekday").notNull(),
        startTime: text("start_time").notNull(),
        endTime: text("end_time").notNull(),
    },
    (table) => ({
        weekdayCheck: check(
            "master_breaks_weekday_check",
            sql`${table.weekday} >= 0 AND ${table.weekday} <= 6`
        ),
    })
);

export const blockedTimes = pgTable(
    "blocked_times",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id, { onDelete: "cascade" }),
        startAt: timestamp("start_at").notNull(),
        endAt: timestamp("end_at").notNull(),
        reason: blockedTimeReasonEnum("reason").notNull(),
        notes: text("notes"),
        createdById: text("created_by_id").notNull(),
        recurrenceRuleId: uuid("recurrence_rule_id"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        endAfterStartCheck: check(
            "blocked_times_end_after_start_check",
            sql`${table.endAt} > ${table.startAt}`
        ),
    })
);

export const calendarExceptions = pgTable(
  "calendar_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    masterId: uuid("master_id")
      .references(() => masters.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "DAY_OFF" | "BLOCKED_TIME" | "STUDIO_CLOSURE"
    reason: text("reason"),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
    deletedById: text("deleted_by_id"),
  },
  (table) => ({
    studioMasterRangeIdx: index("calendar_exceptions_studio_master_range_idx").on(
      table.studioId,
      table.masterId,
      table.startAt,
      table.endAt
    ),
    studioRangeIdx: index("calendar_exceptions_studio_range_idx").on(
      table.studioId,
      table.startAt,
      table.endAt
    ),
    endAfterStartCheck: check(
      "calendar_exceptions_end_after_start_check",
      sql`${table.endAt} > ${table.startAt}`
    ),
  })
);

export const recurrenceRules = pgTable("recurrence_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  masterId: uuid("master_id")
    .notNull()
    .references(() => masters.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // blocked_time, availability, break
  entityId: uuid("entity_id").notNull(),
  frequency: recurrenceFrequencyEnum("frequency").notNull(),
  interval: integer("interval").default(1).notNull(),
  daysOfWeek: text("days_of_week"), // "0,1,2"
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  untilDate: timestamp("until_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const appointments = pgTable(
    "appointments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        clientId: uuid("client_id")
            .notNull()
            .references(() => clients.id, { onDelete: "cascade" }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id, { onDelete: "cascade" }),
        serviceId: uuid("service_id")
            .notNull()
            .references(() => services.id),
        startAt: timestamp("start_at").notNull(),
        endAt: timestamp("end_at").notNull(),
        status: appointmentStatusEnum("status").default("pending").notNull(),
        source: appointmentSourceEnum("source").notNull(),
        notes: text("notes"),
        cancelReason: text("cancel_reason"),
        noShow: boolean("no_show").default(false).notNull(),
        createdById: text("created_by_id").notNull(),
        confirmedAt: timestamp("confirmed_at"),
        completedAt: timestamp("completed_at"),
        cancelledAt: timestamp("cancelled_at"),
        cancelledById: text("cancelled_by_id").references(() => user.id),
        serviceSnapshot: jsonb("service_snapshot").notNull(),
        clientSnapshot: jsonb("client_snapshot").notNull(),
        masterSnapshot: jsonb("master_snapshot").notNull(),
        priceSnapshotCents: integer("price_snapshot_cents").notNull(),
        durationSnapshotMinutes: integer("duration_snapshot_minutes").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        studioIdentity: uniqueIndex("appointments_id_studio_unique").on(table.id, table.studioId),
        clientIdentity: uniqueIndex("appointments_id_studio_client_unique").on(table.id, table.studioId, table.clientId),
        studioIdIdx: index("appointments_studio_id_idx").on(table.studioId),
        masterIdIdx: index("appointments_master_id_idx").on(table.masterId),
        clientIdIdx: index("appointments_client_id_idx").on(table.clientId),
        serviceIdIdx: index("appointments_service_id_idx").on(table.serviceId),
        startAtIdx: index("appointments_start_at_idx").on(table.startAt),
        endAfterStartCheck: check(
            "appointments_end_after_start_check",
            sql`${table.endAt} > ${table.startAt}`
        ),
    })
);

export const appointmentEvents = pgTable("appointment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  appointmentId: uuid("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  type: appointmentEventTypeEnum("type").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const procedureTechniques = pgTable("procedure_techniques", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  area: procedureAreaEnum("area").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedById: text("deleted_by_id"),
});

export const PROCEDURE_SESSION_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "ABORTED",
] as const;
export type ProcedureSessionStatus = typeof PROCEDURE_SESSION_STATUSES[number];

export const procedureSessions = pgTable(
    "procedure_sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        cycleId: uuid("cycle_id"),
        clientId: uuid("client_id")
            .notNull()
            .references(() => clients.id, { onDelete: "cascade" }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id),
        serviceId: uuid("service_id")
            .notNull()
            .references(() => services.id),
        status: text("status").$type<ProcedureSessionStatus>().notNull().default("COMPLETED"),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        abortedAt: timestamp("aborted_at", { withTimezone: true }),
        abortReason: text("abort_reason"),
        commandId: text("command_id"),
        serviceSnapshot: jsonb("service_snapshot").$type<Record<string, unknown>>(),
        masterSnapshot: jsonb("master_snapshot").$type<Record<string, unknown>>(),
        clientSnapshot: jsonb("client_snapshot").$type<Record<string, unknown>>(),
        procedureArea: procedureAreaEnum("procedure_area").notNull(),
        procedureType: procedureTypeEnum("procedure_type").notNull(),
        sessionType: sessionTypeEnum("session_type").notNull(),
        techniqueId: uuid("technique_id").references(() => procedureTechniques.id),
        techniqueSnapshot: jsonb("technique_snapshot"),
        healingStage: healingStageEnum("healing_stage"),
        anesthesia: text("anesthesia"),
        cartridge: text("cartridge"),
        needle: text("needle"),
        voltage: text("voltage"),
        machine: text("machine"),
        skinReaction: text("skin_reaction"),
        painLevel: integer("pain_level"),
        notes: text("notes"),
        recommendations: text("recommendations"),
        nextStep: procedureNextStepEnum("next_step"),
        nextRecommendedDate: timestamp("next_recommended_date"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        cycle: foreignKey({ name: "procedure_cycle_client_fk", columns: [table.cycleId,table.studioId,table.clientId], foreignColumns: [treatmentCycles.id,treatmentCycles.studioId,treatmentCycles.clientId] }),
        visitCycle: foreignKey({ name: "procedure_appointment_cycle_fk", columns: [table.appointmentId,table.cycleId,table.studioId,table.clientId], foreignColumns: [appointmentCycles.appointmentId,appointmentCycles.cycleId,appointmentCycles.studioId,appointmentCycles.clientId] }),
        cycleIdx: index("procedure_sessions_cycle_idx").on(table.studioId,table.cycleId),
        clientIdIdx: index("procedure_sessions_client_id_idx").on(table.clientId),
        masterIdIdx: index("procedure_sessions_master_id_idx").on(table.masterId),
        statusIdx: index("procedure_sessions_studio_status_idx").on(table.studioId, table.status),
        activeCycleUnique: uniqueIndex("procedure_sessions_active_cycle_unique").on(table.cycleId).where(sql`${table.status} = 'IN_PROGRESS' AND ${table.deletedAt} IS NULL`),
        activeAppointmentUnique: uniqueIndex("procedure_sessions_active_appointment_unique").on(table.appointmentId).where(sql`${table.appointmentId} IS NOT NULL AND ${table.status} = 'IN_PROGRESS' AND ${table.deletedAt} IS NULL`),
        commandUnique: uniqueIndex("procedure_sessions_command_unique").on(table.commandId).where(sql`${table.commandId} IS NOT NULL`),
        painLevelCheck: check(
            "procedure_sessions_pain_level_check",
            sql`${table.painLevel} IS NULL OR (${table.painLevel} >= 0 AND ${table.painLevel} <= 10)`
        ),
        statusCheck: check(
            "procedure_sessions_status_check",
            sql`${table.status} IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED')`
        ),
    })
);

export const pigments = pgTable("pigments", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  brand: text("brand").notNull(),
  line: text("line"),
  name: text("name").notNull(),
  color: text("color"),
  code: text("code"),
  temperature: pigmentTemperatureEnum("temperature"),
  baseType: pigmentBaseTypeEnum("base_type"),
  compositionType: pigmentCompositionTypeEnum("composition_type"),
  areaRecommended: pigmentAreaRecommendedEnum("area_recommended"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedById: text("deleted_by_id"),
});

export const procedurePigments = pgTable("procedure_pigments", {
  id: uuid("id").defaultRandom().primaryKey(),
  procedureSessionId: uuid("procedure_session_id")
    .notNull()
    .references(() => procedureSessions.id, { onDelete: "cascade" }),
  pigmentId: uuid("pigment_id")
    .notNull()
    .references(() => pigments.id),
  pigmentSnapshot: jsonb("pigment_snapshot").notNull(),
  mixRatio: text("mix_ratio"),
  drops: integer("drops"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const media = pgTable("media", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id").references(() => appointments.id, {
    onDelete: "set null",
  }),
  procedureSessionId: uuid("procedure_session_id").references(
    () => procedureSessions.id,
    { onDelete: "set null" }
  ),
  type: mediaTypeEnum("type").notNull(),
  url: text("url").notNull(),
  publicId: text("public_id"),
  caption: text("caption"),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedById: text("deleted_by_id"),
}, table => ({
  studioIdentity: uniqueIndex("media_studio_identity").on(table.id, table.studioId),
}));

export const consents = pgTable("consents", {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
        .notNull()
        .references(() => studios.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
    procedureSessionId: uuid("procedure_session_id").references(
        () => procedureSessions.id,
        { onDelete: "set null" }
    ),
    mediaId: uuid("media_id")
        .notNull()
        .references(() => media.id, {
            onDelete: "restrict",
        }),
    consentType: consentTypeEnum("consent_type").notNull(),
    signedAt: timestamp("signed_at").notNull(),
    expiresAt: timestamp("expires_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payments = pgTable(
    "payments",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        clientId: uuid("client_id")
            .notNull()
            .references(() => clients.id, { onDelete: "cascade" }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        procedureSessionId: uuid("procedure_session_id").references(
            () => procedureSessions.id,
            { onDelete: "set null" }
        ),
        totalAmountCents: integer("total_amount_cents").notNull(),
        paidAmountCents: integer("paid_amount_cents").default(0).notNull(),
        balanceAmountCents: integer("balance_amount_cents").notNull(),
        status: paymentStatusEnum("status").default("unpaid").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        studioIdIdx: index("payments_studio_id_idx").on(table.studioId),
        clientIdIdx: index("payments_client_id_idx").on(table.clientId),
        appointmentIdIdx: index("payments_appointment_id_idx").on(table.appointmentId),
        totalAmountCheck: check(
            "payments_total_amount_cents_check",
            sql`${table.totalAmountCents} >= 0`
        ),
        paidAmountCheck: check(
            "payments_paid_amount_cents_check",
            sql`${table.paidAmountCents} >= 0`
        ),
        balanceAmountCheck: check(
            "payments_balance_amount_cents_check",
            sql`${table.balanceAmountCents} >= 0`
        ),
    })
);

export const paymentTransactions = pgTable(
    "payment_transactions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        paymentId: uuid("payment_id")
            .notNull()
            .references(() => payments.id, { onDelete: "cascade" }),
        clientId: uuid("client_id")
            .notNull()
            .references(() => clients.id, { onDelete: "cascade" }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        procedureSessionId: uuid("procedure_session_id").references(
            () => procedureSessions.id,
            { onDelete: "set null" }
        ),
        type: paymentTransactionTypeEnum("type").notNull(),
        method: paymentMethodEnum("method").notNull(),
        amountCents: integer("amount_cents").notNull(),
        note: text("note"),
        createdById: text("created_by_id").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        amountCheck: check(
            "payment_transactions_amount_cents_check",
            sql`${table.amountCents} <> 0`
        ),
    })
);

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(), // appointment_confirmation, etc.
  body: text("body").notNull(),
  variables: jsonb("variables"),
  language: text("language").default("ru").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedById: text("deleted_by_id"),
}, table => ({ studioIdentity: uniqueIndex("whatsapp_templates_id_studio_unique").on(table.id, table.studioId) }));

export const tasks = pgTable(
    "tasks",
    {
        consultationId: uuid("consultation_id").references(() => consultations.id),
        followUpResultId: uuid("follow_up_result_id").references(() => consultationResults.id),
        followUpRevisionId: uuid("follow_up_revision_id").references(() => followUpRevisions.id),
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        assignedToId: text("assigned_to_id")
            .notNull()
            .references(() => user.id),
        clientId: uuid("client_id").references(() => clients.id, {
            onDelete: "set null",
        }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        procedureSessionId: uuid("procedure_session_id").references(
            () => procedureSessions.id,
            { onDelete: "set null" }
        ),
        title: text("title").notNull(),
        description: text("description"),
        type: taskTypeEnum("type").notNull(),
        status: taskStatusEnum("status").default("pending").notNull(),
        priority: taskPriorityEnum("priority").default("normal").notNull(),
        dueAt: timestamp("due_at"),
        completedAt: timestamp("completed_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        consultationUnique: uniqueIndex("tasks_consultation_unique").on(table.consultationId),
        followUpUnique: uniqueIndex("tasks_follow_up_result_unique").on(table.followUpResultId).where(sql`${table.followUpRevisionId} is null`),
        followUpRevisionUnique: uniqueIndex("tasks_follow_up_revision_unique").on(table.followUpRevisionId),
        studioIdIdx: index("tasks_studio_id_idx").on(table.studioId),
        assignedToIdIdx: index("tasks_assigned_to_id_idx").on(table.assignedToId),
        dueAtIdx: index("tasks_due_at_idx").on(table.dueAt),
        statusIdx: index("tasks_status_idx").on(table.status),
    })
);

export const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        clientId: uuid("client_id").references(() => clients.id, {
            onDelete: "set null",
        }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        taskId: uuid("task_id").references(() => tasks.id, {
            onDelete: "set null",
        }),
        type: notificationTypeEnum("type").notNull(),
        title: text("title").notNull(),
        message: text("message").notNull(),
        status: notificationStatusEnum("status").default("unread").notNull(),
        scheduledFor: timestamp("scheduled_for"),
        readAt: timestamp("read_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        studioIdIdx: index("notifications_studio_id_idx").on(table.studioId),
        userIdIdx: index("notifications_user_id_idx").on(table.userId),
        statusIdx: index("notifications_status_idx").on(table.status),
        userStatusIdx: index("notifications_user_id_status_idx").on(
            table.userId,
            table.status
        ),
    })
);

export const activityEvents = pgTable(
    "activity_events",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        clientId: uuid("client_id").references(() => clients.id, {
            onDelete: "cascade",
        }),
        appointmentId: uuid("appointment_id").references(() => appointments.id, {
            onDelete: "set null",
        }),
        procedureSessionId: uuid("procedure_session_id").references(
            () => procedureSessions.id,
            { onDelete: "set null" }
        ),
        paymentId: uuid("payment_id").references(() => payments.id, {
            onDelete: "set null",
        }),
        taskId: uuid("task_id").references(() => tasks.id, {
            onDelete: "set null",
        }),
        mediaId: uuid("media_id").references(() => media.id, {
            onDelete: "set null",
        }),
        reviewId: uuid("review_id").references(() => reviews.id, {
            onDelete: "set null",
        }),
        userId: text("user_id").references(() => user.id, {
            onDelete: "set null",
        }),
        type: activityEventTypeEnum("type").notNull(),
        title: text("title").notNull(),
        description: text("description"),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        studioIdIdx: index("activity_events_studio_id_idx").on(table.studioId),
        clientCreatedAtIdx: index("activity_events_client_id_created_at_idx").on(
            table.clientId,
            table.createdAt
        ),
        createdAtIdx: index("activity_events_created_at_idx").on(table.createdAt),
    })
);

export const questionnaireTemplates = pgTable("questionnaire_templates", {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
        .notNull()
        .references(() => studios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    procedureArea: procedureAreaEnum("procedure_area").notNull(),
    sessionType: sessionTypeEnum("session_type").notNull(),
    questions: jsonb("questions").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const questionnaireResponses = pgTable("questionnaire_responses", {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
        .notNull()
        .references(() => studios.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
        onDelete: "set null",
    }),
    procedureSessionId: uuid("procedure_session_id").references(
        () => procedureSessions.id,
        { onDelete: "set null" }
    ),
    templateId: uuid("template_id")
        .notNull()
        .references(() => questionnaireTemplates.id),
    answers: jsonb("answers").notNull(),
    riskLevel: text("risk_level"),
    requiresAttention: boolean("requires_attention").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reviews = pgTable(
    "reviews",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        clientId: uuid("client_id")
            .notNull()
            .references(() => clients.id, { onDelete: "cascade" }),
        masterId: uuid("master_id").references(() => masters.id),
        serviceId: uuid("service_id").references(() => services.id),
        appointmentId: uuid("appointment_id").references(() => appointments.id),
        procedureSessionId: uuid("procedure_session_id").references(
            () => procedureSessions.id
        ),
        rating: integer("rating").notNull(),
        text: text("text"),
        source: reviewSourceEnum("source").notNull(),
        status: reviewStatusEnum("status").default("draft").notNull(),
        isPortfolioAllowed: boolean("is_portfolio_allowed").default(false).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
        deletedAt: timestamp("deleted_at"),
        deletedById: text("deleted_by_id"),
    },
    (table) => ({
        ratingCheck: check(
            "reviews_rating_check",
            sql`${table.rating} >= 1 AND ${table.rating} <= 5`
        ),
    })
);

export const exportJobs = pgTable("export_jobs", {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
        .notNull()
        .references(() => studios.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => user.id),
    type: exportTypeEnum("type").notNull(),
    status: exportStatusEnum("status").default("pending").notNull(),
    fileUrl: text("file_url"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id),
  action: text("action").$type<AuditAction>().notNull(),
  contractVersion: integer("contract_version").default(1).notNull(),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  reason: text("reason"),
  reasonSource: text("reason_source"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  studioTime: index("audit_logs_studio_time_idx").on(table.studioId, table.createdAt, table.id),
  contractCheck: check("audit_logs_contract_check", sql`${table.contractVersion} = 0 or (${table.contractVersion} = 1
    and ${table.userId} is not null and ${table.oldValues} is not null and ${table.newValues} is not null
    and ${table.reason} is not null and length(trim(${table.reason})) > 0 and ${table.reasonSource} is not null and ${table.reasonSource} in ('user', 'command')
    and ${table.entityType} = case ${table.action} ${sql.raw(Object.entries(AUDIT_ENTITIES).map(([action, entity]) => `when '${action}' then '${entity}'`).join(' '))} else '__invalid__' end
    and ${table.action} in (${sql.raw(Object.keys(AUDIT_ENTITIES).map(action => `'${action}'`).join(', '))}))`),
}));



export const accessLogs = pgTable("access_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  // Stable actor identity survives account deletion; do not retain names/emails.
  actorId: text("actor_id").notNull(),
  operation: text("operation").notNull(),
  targetId: text("target_id"),
  result: text("result").notNull(),
  recordIds: jsonb("record_ids").$type<string[]>().notNull(),
  recordCount: integer("record_count").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  studioTime: index("access_logs_studio_time_idx").on(table.studioId, table.createdAt, table.id),
  actorTime: index("access_logs_actor_time_idx").on(table.studioId, table.actorId, table.createdAt),
  operationCheck: check("access_logs_operation_check", sql`${table.operation} in (${sql.raw(ACCESS_OPERATIONS.map(operation => `'${operation}'`).join(', '))})`),
  resultCheck: check("access_logs_result_check", sql`${table.result} in ('returned', 'not_returned', 'denied', 'error')`),
  countCheck: check("access_logs_count_check", sql`${table.recordCount} >= 0 and jsonb_typeof(${table.recordIds}) = 'array' and jsonb_array_length(${table.recordIds}) = ${table.recordCount}`),
}));

// Command receipts are committed only together with the domain mutation.
export const commandReceipts = pgTable("command_receipts", {
  id: uuid("id").primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  command: text("command").notNull(),
  requestKey: uuid("request_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ key: uniqueIndex("command_receipts_key_idx").on(table.studioId, table.actorId, table.command, table.requestKey) }));

export const eventInbox = pgTable("event_inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  consumer: text("consumer").notNull(),
  eventKey: text("event_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ key: uniqueIndex("event_inbox_key_idx").on(table.studioId, table.consumer, table.eventKey) }));

export const outboxJobs = pgTable("outbox_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  handler: text("handler").notNull(),
  effectType: text("effect_type").notNull().default("transactional"),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  externalId: text("external_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  key: uniqueIndex("outbox_jobs_key_idx").on(table.studioId, table.handler, table.eventKey),
  ready: index("outbox_jobs_ready_idx").on(table.state, table.availableAt, table.leaseUntil),
  studio: index("outbox_jobs_studio_idx").on(table.studioId, table.createdAt),
  effectCheck: check("outbox_jobs_effect_check", sql`${table.effectType} in ('transactional','external')`),
  stateCheck: check("outbox_jobs_state_check", sql`${table.state} in ('pending','processing','reconciling','completed','dead','uncertain')`),
  attemptCheck: check("outbox_jobs_attempt_check", sql`${table.attempts} >= 0 and ${table.maxAttempts} between 1 and 20`),
  leaseCheck: check("outbox_jobs_lease_check", sql`(${table.state} in ('processing','reconciling') and ${table.leaseToken} is not null and ${table.leaseUntil} is not null)
    or (${table.state} not in ('processing','reconciling') and ${table.leaseToken} is null and ${table.leaseUntil} is null)`),
}));

export const jobAttempts = pgTable("job_attempts", {
  id: uuid("id").primaryKey(), // Lease token also fences late results.
  jobId: uuid("job_id").notNull().references(() => outboxJobs.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  outcome: text("outcome").notNull().default("started"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => ({ job: index("job_attempts_job_idx").on(table.jobId, table.startedAt) }));

// Append-only pricing/offer history; database triggers reject changes to recorded revisions.
export const masterPriceRevisions = pgTable("master_price_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull(), masterId: uuid("master_id").notNull(),
  revision: integer("revision").notNull(), priceCents: integer("price_cents"),
  reason: text("reason").notNull(), approvedById: text("approved_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  version: uniqueIndex("master_price_revision_unique").on(table.studioId, table.serviceId, table.masterId, table.revision),
  service: foreignKey({ columns: [table.serviceId, table.studioId], foreignColumns: [services.id, services.studioId] }),
  master: foreignKey({ columns: [table.masterId, table.studioId], foreignColumns: [masters.id, masters.studioId] }),
  contract: check("master_price_revision_check", sql`${table.revision} > 0 and (${table.priceCents} is null or ${table.priceCents} >= 0) and length(trim(${table.reason})) > 0`),
}));
export const customOffers = pgTable("custom_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  identity: uniqueIndex("custom_offers_id_studio_unique").on(table.id, table.studioId),
  client: foreignKey({ columns: [table.clientId, table.studioId], foreignColumns: [clients.id, clients.studioId] }),
}));
export const offerRevisions = pgTable("offer_revisions", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  offerId: uuid("offer_id").notNull(), revision: integer("revision").notNull(),
  standardTotalCents: integer("standard_total_cents").notNull(), agreedTotalCents: integer("agreed_total_cents").notNull(), discountCents: integer("discount_cents").notNull(),
  currency: text("currency").notNull().default("EUR"), reason: text("reason").notNull(), approvedById: text("approved_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  identity: uniqueIndex("offer_revisions_id_studio_unique").on(table.id, table.studioId),
  version: uniqueIndex("offer_revision_unique").on(table.offerId, table.revision),
  offer: foreignKey({ columns: [table.offerId, table.studioId], foreignColumns: [customOffers.id, customOffers.studioId] }),
  totals: check("offer_revision_totals_check", sql`${table.revision} > 0 and ${table.standardTotalCents} >= 0 and ${table.agreedTotalCents} >= 0 and ${table.discountCents} = greatest(0, ${table.standardTotalCents} - ${table.agreedTotalCents}) and ${table.currency} = 'EUR' and length(trim(${table.reason})) > 0`),
}));
export const offerItems = pgTable("offer_items", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").notNull(), serviceId: uuid("service_id").notNull(), masterId: uuid("master_id"),
  zoneCode: text("zone_code").notNull().references(() => catalogZones.code),
  serviceName: text("service_name").notNull(), masterName: text("master_name"),
  standardCents: integer("standard_cents").notNull(), priceSnapshot: jsonb("price_snapshot").$type<{ source: string; mode: string; priceCents: number | null; priceMaxCents: number | null; version: string; humanQuoted: boolean }>().notNull(),
}, table => ({
  zone: uniqueIndex("offer_items_zone_unique").on(table.revisionId, table.zoneCode),
  revision: foreignKey({ columns: [table.revisionId, table.studioId], foreignColumns: [offerRevisions.id, offerRevisions.studioId] }),
  service: foreignKey({ columns: [table.serviceId, table.studioId], foreignColumns: [services.id, services.studioId] }),
  master: foreignKey({ columns: [table.masterId, table.studioId], foreignColumns: [masters.id, masters.studioId] }),
  amount: check("offer_item_amount_check", sql`${table.standardCents} >= 0 and ${table.zoneCode} in ('brows','eyes','lips')`),
}));

export const clientDuplicateDecisions = pgTable("client_duplicate_decisions", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(), actorId: text("actor_id").notNull(), reason: text("reason").notNull(), reviewToken: text("review_token").notNull(),
  matches: jsonb("matches").$type<{ id: string; level: string; reasons: string[] }[]>().notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ client: foreignKey({ columns: [table.clientId, table.studioId], foreignColumns: [clients.id, clients.studioId] }),
  identity: index("client_duplicate_decision_client_idx").on(table.clientId),
  reasonCheck: check("client_duplicate_decision_reason_check", sql`length(trim(${table.reason})) >= 3`),
}));

// Immutable evidence; source IDs remain as archived aliases in clients.
export const clientMerges = pgTable("client_merges", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull(), targetId: uuid("target_id").notNull(), actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(), reviewToken: text("review_token").notNull(),
  sourceSnapshot: jsonb("source_snapshot").notNull(), targetSnapshot: jsonb("target_snapshot").notNull(), resultSnapshot: jsonb("result_snapshot").notNull(),
  provenance: jsonb("provenance").$type<Record<string, string>>().notNull(),
  movedRecords: jsonb("moved_records").$type<Record<string, string[]>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  source: foreignKey({ columns: [table.sourceId, table.studioId], foreignColumns: [clients.id, clients.studioId] }),
  target: foreignKey({ columns: [table.targetId, table.studioId], foreignColumns: [clients.id, clients.studioId] }),
  sourceUnique: uniqueIndex("client_merges_source_unique").on(table.sourceId),
  contract: check("client_merges_check", sql`${table.sourceId} != ${table.targetId} and length(trim(${table.reason})) >= 3`),
}));

// Phase 3.1 foundation. No migration invents cycles from clientStatus or legacy visits.
export const treatmentPackages = pgTable("treatment_packages", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, {onDelete:"cascade"}),
  clientId: uuid("client_id").notNull(), kind: text("kind").notNull().default("total_face"),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1), commercialSnapshot: jsonb("commercial_snapshot"),
  createdById: text("created_by_id"), completedAt: timestamp("completed_at", {withTimezone:true}),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", {withTimezone:true}),
}, table => ({
  identity: uniqueIndex("treatment_packages_identity").on(table.id,table.studioId,table.clientId),
  client: foreignKey({name:"treatment_packages_client_fk",columns:[table.clientId,table.studioId],foreignColumns:[clients.id,clients.studioId]}),
  contract: check("treatment_packages_contract", sql`${table.kind} = 'total_face' and ${table.status} in ('active', 'completed', 'archived') and ${table.version} > 0 and (${table.commercialSnapshot} is null or jsonb_typeof(${table.commercialSnapshot}) = 'object')`),
}));
export const treatmentCycles = pgTable("treatment_cycles", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, {onDelete:"cascade"}),
  clientId: uuid("client_id").notNull(), zoneCode: text("zone_code").notNull().references(() => catalogZones.code),
  kind: text("kind").notNull(), stage: text("stage").notNull().default("new_lead"), version: integer("version").notNull().default(1),
  serviceId: uuid("service_id"), assignedMasterId: uuid("assigned_master_id"), packageId: uuid("package_id"), originCycleId: uuid("origin_cycle_id"),
  offerRevisionId: uuid("offer_revision_id"), serviceSnapshot: jsonb("service_snapshot"), commercialSnapshot: jsonb("commercial_snapshot"),
  firstSessionAt: timestamp("first_session_at", {withTimezone:true}), secondSessionAt: timestamp("second_session_at", {withTimezone:true}),
  completedAt: timestamp("completed_at", {withTimezone:true}), lastPerformedPmuAt: timestamp("last_performed_pmu_at", {withTimezone:true}),
  suspendedAt: timestamp("suspended_at", {withTimezone:true}), suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(), updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(), archivedAt: timestamp("archived_at", {withTimezone:true}),
}, table => ({
  identity: uniqueIndex("treatment_cycles_identity").on(table.id,table.studioId,table.clientId),
  studioIdentity: uniqueIndex("treatment_cycles_studio_identity").on(table.id,table.studioId),
  zoneIdentity: uniqueIndex("treatment_cycles_zone_identity").on(table.id,table.studioId,table.clientId,table.zoneCode),
  packageZone: uniqueIndex("treatment_cycles_package_zone_unique").on(table.packageId,table.zoneCode),
  clientIdx: index("treatment_cycles_client_idx").on(table.studioId,table.clientId),
  masterIdx: index("treatment_cycles_master_idx").on(table.studioId,table.assignedMasterId),
  client: foreignKey({name:"treatment_cycles_client_fk",columns:[table.clientId,table.studioId],foreignColumns:[clients.id,clients.studioId]}),
  service: foreignKey({name:"treatment_cycles_service_fk",columns:[table.serviceId,table.studioId],foreignColumns:[services.id,services.studioId]}),
  master: foreignKey({name:"treatment_cycles_master_fk",columns:[table.assignedMasterId,table.studioId],foreignColumns:[masters.id,masters.studioId]}),
  package: foreignKey({name:"treatment_cycles_package_fk",columns:[table.packageId,table.studioId,table.clientId],foreignColumns:[treatmentPackages.id,treatmentPackages.studioId,treatmentPackages.clientId]}),
  origin: foreignKey({name:"treatment_cycles_origin_fk",columns:[table.originCycleId,table.studioId,table.clientId,table.zoneCode],foreignColumns:[table.id,table.studioId,table.clientId,table.zoneCode]}),
  offer: foreignKey({name:"treatment_cycles_offer_fk",columns:[table.offerRevisionId,table.studioId],foreignColumns:[offerRevisions.id,offerRevisions.studioId]}),
  contract: check("treatment_cycles_contract", sql`${table.kind} in (${sql.join(CYCLE_KINDS.map(value => sql.raw("'"+value+"'")),sql`,`)})
    and ${table.stage} in (${sql.join(CYCLE_STAGES.map(value => sql.raw("'"+value+"'")),sql`,`)}) and ${table.version} > 0
    and ${table.zoneCode} in ('brows','eyes','lips','lashes','skin') and (${table.kind} = 'non_pmu' or ${table.zoneCode} in ('brows','eyes','lips'))
    and (${table.originCycleId} is null or ${table.originCycleId} != ${table.id})
    and (${table.kind} not in ('refresh','paid_correction','free_correction') or ${table.originCycleId} is not null)
    and (${table.packageId} is null or ${table.kind} = 'pmu')
    and (${table.serviceSnapshot} is null or jsonb_typeof(${table.serviceSnapshot}) = 'object')
    and (${table.commercialSnapshot} is null or jsonb_typeof(${table.commercialSnapshot}) = 'object')
    and ((${table.suspendedAt} is null and ${table.suspensionReason} is null) or (${table.suspendedAt} is not null and ${table.suspensionReason} is not null and length(trim(${table.suspensionReason})) > 0))
    and (${table.secondSessionAt} is null or (${table.firstSessionAt} is not null and ${table.secondSessionAt} >= ${table.firstSessionAt}))`),
}));
export const appointmentCycles = pgTable("appointment_cycles", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id,{onDelete:"cascade"}), clientId: uuid("client_id").notNull(),
  appointmentId: uuid("appointment_id").notNull(), cycleId: uuid("cycle_id").notNull(), visitKind: text("visit_kind").notNull(),
  serviceSnapshot: jsonb("service_snapshot").notNull(), commercialSnapshot: jsonb("commercial_snapshot"), createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, table => ({
  identity: uniqueIndex("appointment_cycles_identity").on(table.appointmentId,table.cycleId,table.studioId,table.clientId),
  studioIdentity: uniqueIndex("appointment_cycles_studio_identity").on(table.appointmentId,table.cycleId,table.studioId),
  pair: uniqueIndex("appointment_cycles_pair_unique").on(table.appointmentId,table.cycleId),
  client: foreignKey({name:"appointment_cycles_client_fk",columns:[table.clientId,table.studioId],foreignColumns:[clients.id,clients.studioId]}),
  appointment: foreignKey({name:"appointment_cycles_appointment_fk",columns:[table.appointmentId,table.studioId,table.clientId],foreignColumns:[appointments.id,appointments.studioId,appointments.clientId]}),
  cycle: foreignKey({name:"appointment_cycles_cycle_fk",columns:[table.cycleId,table.studioId,table.clientId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId,treatmentCycles.clientId]}),
  contract: check("appointment_cycles_contract",sql`${table.visitKind} in ('consultation','session_1','session_2','control','correction','refresh','remover','single_session') and jsonb_typeof(${table.serviceSnapshot}) = 'object' and (${table.commercialSnapshot} is null or jsonb_typeof(${table.commercialSnapshot}) = 'object')`),
}));

export const cycleStageHistory = pgTable("cycle_stage_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id").notNull().references(() => studios.id,{onDelete:"cascade"}),
  cycleId: uuid("cycle_id").notNull(), commandId: uuid("command_id").notNull(),
  actorId: text("actor_id").notNull(), fromStage: text("from_stage"), toStage: text("to_stage").notNull(),
  version: integer("version").notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
}, table => ({
  cycle: foreignKey({name:"cycle_stage_history_cycle_fk",columns:[table.cycleId,table.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),
  command: foreignKey({name:"cycle_stage_history_command_fk",columns:[table.commandId],foreignColumns:[commandReceipts.id]}),
  version: uniqueIndex("cycle_stage_history_version_unique").on(table.cycleId,table.version),
  commandUnique: uniqueIndex("cycle_stage_history_command_unique").on(table.commandId,table.cycleId,table.version),
  contract: check("cycle_stage_history_contract",sql`${table.version} > 0 and length(trim(${table.reason})) between 3 and 1000
    and ${table.toStage} in (${sql.join(CYCLE_STAGES.map(value=>sql.raw("'"+value+"'")),sql`,`)})
    and (${table.fromStage} is null or ${table.fromStage} in (${sql.join(CYCLE_STAGES.map(value=>sql.raw("'"+value+"'")),sql`,`)}))`),
}));

export const cycleQualifications = pgTable("cycle_qualifications", {
  id:uuid("id").defaultRandom().primaryKey(),studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),cycleId:uuid("cycle_id").notNull(),
  actorId:text("actor_id").notNull(),commandId:uuid("command_id").notNull(),cycleVersion:integer("cycle_version").notNull(),
  otherMasterPmu:boolean("other_master_pmu").notNull(),doubt:boolean("doubt").notNull(),conditionChanged:boolean("condition_changed").notNull(),evaluationRequired:boolean("evaluation_required").notNull(),
  consultationRequired:boolean("consultation_required").notNull(),evidence:jsonb("evidence").notNull(),reason:text("reason").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({cycle:foreignKey({name:"qualification_cycle_fk",columns:[t.cycleId,t.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),version:uniqueIndex("qualification_version_unique").on(t.cycleId,t.cycleVersion),command:uniqueIndex("qualification_command_unique").on(t.commandId),contract:check("qualification_contract",sql`${t.cycleVersion}>0 and length(trim(${t.reason}))>=3 and jsonb_typeof(${t.evidence})='object'`)}));
export const consultations = pgTable("consultations", {
  id:uuid("id").defaultRandom().primaryKey(),studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),cycleId:uuid("cycle_id").notNull(),appointmentId:uuid("appointment_id").notNull(),masterId:uuid("master_id").notNull(),
  completedBy:text("completed_by").notNull(),completionReason:text("completion_reason").notNull(),completedAt:timestamp("completed_at",{withTimezone:true}).notNull(),decisionDueAt:timestamp("decision_due_at",{withTimezone:true}).notNull(),resultRecordedAt:timestamp("result_recorded_at",{withTimezone:true}),
},t=>({identity:uniqueIndex("consultations_identity").on(t.id,t.studioId),visit:uniqueIndex("consultations_cycle_visit_unique").on(t.cycleId,t.appointmentId),cycle:foreignKey({name:"consultations_cycle_fk",columns:[t.cycleId,t.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),appointment:foreignKey({name:"consultations_visit_fk",columns:[t.appointmentId,t.cycleId,t.studioId],foreignColumns:[appointmentCycles.appointmentId,appointmentCycles.cycleId,appointmentCycles.studioId]}),master:foreignKey({name:"consultations_master_fk",columns:[t.masterId,t.studioId],foreignColumns:[masters.id,masters.studioId]}),due:check("consultations_due_check",sql`${t.decisionDueAt}>${t.completedAt}`)}));
export const consultationResults = pgTable("consultation_results", {
  id:uuid("id").defaultRandom().primaryKey(),studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),consultationId:uuid("consultation_id").notNull(),
  actorId:text("actor_id").notNull(),commandId:uuid("command_id").notNull(),outcome:text("outcome").notNull(),reason:text("reason").notNull(),comment:text("comment").notNull(),
  reassessmentAt:timestamp("reassessment_at",{withTimezone:true}),followUpAt:timestamp("follow_up_at",{withTimezone:true}),removerCycleId:uuid("remover_cycle_id"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({consultation:foreignKey({name:"result_consultation_fk",columns:[t.consultationId,t.studioId],foreignColumns:[consultations.id,consultations.studioId]}),remover:foreignKey({name:"result_remover_fk",columns:[t.removerCycleId,t.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),once:uniqueIndex("result_consultation_unique").on(t.consultationId),command:uniqueIndex("result_command_unique").on(t.commandId),contract:check("consultation_result_contract",sql`${t.outcome} in (${sql.join(OUTCOMES.map(v=>sql.raw("'"+v+"'")),sql`,`)}) and length(trim(${t.reason}))>=3
 and (${t.outcome}!='temporarily_unavailable' or (${t.reassessmentAt} is not null and length(trim(${t.comment}))>0))
 and ((${t.outcome}='client_thinking' and ${t.followUpAt} is not null) or (${t.outcome}!='client_thinking' and ${t.followUpAt} is null))
 and ((${t.outcome}='removal_required' and ${t.removerCycleId} is not null) or (${t.outcome}!='removal_required' and ${t.removerCycleId} is null))`)}));

export const followUpRevisions = pgTable("follow_up_revisions", {
  id:uuid("id").defaultRandom().primaryKey(),
  studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),
  resultId:uuid("result_id").notNull().references(()=>consultationResults.id),
  sequence:integer("sequence").notNull(),
  dueAt:timestamp("due_at",{withTimezone:true}).notNull(),
  actorId:text("actor_id").notNull(),commandId:uuid("command_id").notNull(),
  reason:text("reason").notNull(),comment:text("comment").notNull(),
  createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({sequence:uniqueIndex("follow_up_revision_sequence").on(t.resultId,t.sequence),
 command:uniqueIndex("follow_up_revision_command").on(t.commandId),
 contract:check("follow_up_revision_contract",sql`${t.sequence}>0 and length(trim(${t.reason})) between 3 and 1000 and length(trim(${t.comment})) between 1 and 2000`)}));

export const cycleReviews=pgTable("cycle_reviews",{
 id:uuid("id").defaultRandom().primaryKey(),studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),
 cycleId:uuid("cycle_id").notNull(),resultId:uuid("result_id").references(()=>consultationResults.id),
 commandId:uuid("command_id").notNull(),actorId:text("actor_id").notNull(),operation:text("operation").notNull(),
 reason:text("reason").notNull(),comment:text("comment").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({cycle:foreignKey({name:"cycle_review_cycle_fk",columns:[t.cycleId,t.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),
 command:uniqueIndex("cycle_review_command_unique").on(t.commandId),contract:check("cycle_review_contract",sql`${t.operation} in ('reassess','lost') and length(trim(${t.reason})) between 3 and 1000 and length(trim(${t.comment})) between 1 and 2000`)}));
export const followUpClosures=pgTable("follow_up_closures",{
 id:uuid("id").defaultRandom().primaryKey(),studioId:uuid("studio_id").notNull().references(()=>studios.id,{onDelete:"cascade"}),
 resultId:uuid("result_id").notNull().references(()=>consultationResults.id),actorId:text("actor_id").notNull(),
 reason:text("reason").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({result:uniqueIndex("follow_up_closure_result_unique").on(t.resultId),contract:check("follow_up_closure_reason",sql`${t.reason} in ('cycle_left_branch','client_archived')`)}));

// Immutable, human-confirmed terms. Offer totals belong to the offer, not to each cycle.
export const cycleCommercialTerms = pgTable("cycle_commercial_terms", {
  id: uuid("id").defaultRandom().primaryKey(), studioId: uuid("studio_id").notNull().references(() => studios.id, {onDelete:"cascade"}),
  cycleId: uuid("cycle_id").notNull(), revision: integer("revision").notNull(), cycleVersion: integer("cycle_version").notNull(),
  commandId: uuid("command_id").notNull(), actorId: text("actor_id").notNull(),
  source: text("source").notNull(), serviceId: uuid("service_id").notNull(), masterId: uuid("master_id"),
  offerItemId: uuid("offer_item_id").references(() => offerItems.id),
  amountCents: integer("amount_cents"), currency: text("currency").notNull().default("EUR"),
  sourceSnapshot: jsonb("source_snapshot").$type<Record<string, string | number | boolean | null>>().notNull(),
  reason: text("reason").notNull(), confirmedAt: timestamp("confirmed_at", {withTimezone:true}).notNull().defaultNow(),
  reviewAt: timestamp("review_at", {withTimezone:true}).notNull(),
}, t => ({
  cycle: foreignKey({name:"commercial_terms_cycle_fk",columns:[t.cycleId,t.studioId],foreignColumns:[treatmentCycles.id,treatmentCycles.studioId]}),
  service: foreignKey({name:"commercial_terms_service_fk",columns:[t.serviceId,t.studioId],foreignColumns:[services.id,services.studioId]}),
  master: foreignKey({name:"commercial_terms_master_fk",columns:[t.masterId,t.studioId],foreignColumns:[masters.id,masters.studioId]}),
  version: uniqueIndex("commercial_terms_revision_unique").on(t.cycleId,t.revision),
  command: uniqueIndex("commercial_terms_command_unique").on(t.commandId),
  contract: check("commercial_terms_contract",sql`${t.revision}>0 and ${t.cycleVersion}>0 and ${t.currency}='EUR' and ${t.reviewAt}>${t.confirmedAt} and length(trim(${t.reason})) between 3 and 1000 and jsonb_typeof(${t.sourceSnapshot})='object' and ((${t.source}='catalog' and ${t.offerItemId} is null and ${t.amountCents} is not null and ${t.amountCents}>=0) or (${t.source}='offer' and ${t.offerItemId} is not null and ${t.amountCents} is null))`),
}));

export const CYCLE_MEDICAL_CLEARANCE_DECISIONS = [
  "CLEARED",
  "CONSULTATION_REQUIRED",
  "NOT_CLEARED",
] as const;

export type CycleMedicalClearanceDecision = typeof CYCLE_MEDICAL_CLEARANCE_DECISIONS[number];

export const cycleMedicalClearances = pgTable("cycle_medical_clearances", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => treatmentCycles.id),
  medicalRevisionId: uuid("medical_revision_id")
    .notNull()
    .references(() => medicalProfileRevisions.id),
  decisionNumber: integer("decision_number").notNull(),
  decision: text("decision").$type<CycleMedicalClearanceDecision>().notNull(),
  reason: text("reason").notNull(),
  clinicalNotes: text("clinical_notes"),
  decidedById: text("decided_by_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  cycleDecisionUnique: uniqueIndex("cycle_medical_clearances_cycle_decision_unique").on(table.cycleId, table.decisionNumber),
  studioIdx: index("cycle_medical_clearances_studio_idx").on(table.studioId),
  medicalRevisionIdx: index("cycle_medical_clearances_medical_revision_idx").on(table.medicalRevisionId),
  cycleMedicalRevisionIdx: index("cycle_medical_clearances_cycle_medical_revision_idx").on(table.cycleId, table.medicalRevisionId),
  decisionCheck: check("cycle_medical_clearances_decision_check", sql`${table.decision} in ('CLEARED', 'CONSULTATION_REQUIRED', 'NOT_CLEARED')`),
  decisionNumberPositive: check("cycle_medical_clearances_decision_number_positive", sql`${table.decisionNumber} > 0`),
}));

export const consentTemplates = pgTable("consent_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, table => ({
  studioCodeUnique: uniqueIndex("consent_templates_studio_code_unique").on(table.studioId, table.code),
  identity: uniqueIndex("consent_templates_identity").on(table.id, table.studioId),
  studioIdx: index("consent_templates_studio_idx").on(table.studioId),
  contract: check("consent_templates_contract", sql`length(trim(${table.code})) > 0 and length(trim(${table.name})) > 0`),
}));

export const consentTemplateVersions = pgTable("consent_template_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, table => ({
  templateFk: foreignKey({
    name: "consent_template_versions_template_fk",
    columns: [table.templateId, table.studioId],
    foreignColumns: [consentTemplates.id, consentTemplates.studioId],
  }).onDelete("restrict"),
  templateVersionUnique: uniqueIndex("consent_template_versions_template_version_unique").on(table.templateId, table.versionNumber),
  identity: uniqueIndex("consent_template_versions_identity").on(table.id, table.studioId),
  studioIdx: index("consent_template_versions_studio_idx").on(table.studioId),
  templateIdx: index("consent_template_versions_template_idx").on(table.templateId),
  versionPositive: check("consent_template_versions_version_positive", sql`${table.versionNumber} > 0`),
  contentCheck: check("consent_template_versions_content_check", sql`length(trim(${table.title})) > 0 and length(trim(${table.body})) > 0 and length(trim(${table.contentHash})) = 64`),
}));

export const CYCLE_CONSENT_STATUSES = ["DRAFT", "SIGNED"] as const;
export type CycleConsentStatus = typeof CYCLE_CONSENT_STATUSES[number];

export const CYCLE_CONSENT_SIGNATURE_METHODS = [
  "in_person_stylus",
  "draw_on_screen",
  "remote_link",
  "biometric",
] as const;
export type CycleConsentSignatureMethod = typeof CYCLE_CONSENT_SIGNATURE_METHODS[number];

export const CYCLE_CONSENT_SIGNATORY_ROLES = [
  "client",
  "guardian",
  "representative",
] as const;
export type CycleConsentSignatoryRole = typeof CYCLE_CONSENT_SIGNATORY_ROLES[number];

export const cycleConsents = pgTable("cycle_consents", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id").notNull(),
  clientId: uuid("client_id").notNull(),
  templateVersionId: uuid("template_version_id").notNull(),
  status: text("status").$type<CycleConsentStatus>().notNull().default("DRAFT"),
  mediaId: uuid("media_id"),
  signedPdfSha256: text("signed_pdf_sha256"),
  signatureMethod: text("signature_method").$type<CycleConsentSignatureMethod>(),
  signaturePayload: jsonb("signature_payload").$type<Record<string, unknown>>(),
  signatoryName: text("signatory_name"),
  signatoryRole: text("signatory_role").$type<CycleConsentSignatoryRole>(),
  createdById: text("created_by_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  finalizedById: text("finalized_by_id").references(() => user.id, { onDelete: "restrict" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, table => ({
  cycleFk: foreignKey({
    name: "cycle_consents_cycle_fk",
    columns: [table.cycleId, table.studioId],
    foreignColumns: [treatmentCycles.id, treatmentCycles.studioId],
  }).onDelete("restrict"),
  clientFk: foreignKey({
    name: "cycle_consents_client_fk",
    columns: [table.clientId, table.studioId],
    foreignColumns: [clients.id, clients.studioId],
  }).onDelete("restrict"),
  templateFk: foreignKey({
    name: "cycle_consents_template_fk",
    columns: [table.templateVersionId, table.studioId],
    foreignColumns: [consentTemplateVersions.id, consentTemplateVersions.studioId],
  }).onDelete("restrict"),
  mediaFk: foreignKey({
    name: "cycle_consents_media_fk",
    columns: [table.mediaId, table.studioId],
    foreignColumns: [media.id, media.studioId],
  }).onDelete("restrict"),
  identity: uniqueIndex("cycle_consents_identity").on(table.id, table.studioId),
  studioIdx: index("cycle_consents_studio_idx").on(table.studioId),
  cycleIdx: index("cycle_consents_cycle_idx").on(table.studioId, table.cycleId),
  clientIdx: index("cycle_consents_client_idx").on(table.studioId, table.clientId),
  templateVersionIdx: index("cycle_consents_template_version_idx").on(table.templateVersionId),
  mediaUnique: uniqueIndex("cycle_consents_media_unique").on(table.mediaId).where(sql`${table.mediaId} is not null`),
  statusCheck: check("cycle_consents_status_check", sql`${table.status} in ('DRAFT', 'SIGNED')`),
  signatureMethodCheck: check("cycle_consents_signature_method_check", sql`${table.signatureMethod} is null or ${table.signatureMethod} in ('in_person_stylus', 'draw_on_screen', 'remote_link', 'biometric')`),
  signatoryRoleCheck: check("cycle_consents_signatory_role_check", sql`${table.signatoryRole} is null or ${table.signatoryRole} in ('client', 'guardian', 'representative')`),
  lifecycleCheck: check(
    "cycle_consents_lifecycle_check",
    sql`(
      ${table.status} = 'DRAFT'
      and ${table.signedAt} is null
      and ${table.mediaId} is null
      and ${table.signedPdfSha256} is null
      and ${table.signatureMethod} is null
      and ${table.signaturePayload} is null
      and ${table.finalizedById} is null
      and ${table.finalizedAt} is null
    ) or (
      ${table.status} = 'SIGNED'
      and ${table.signedAt} is not null
      and ${table.mediaId} is not null
      and ${table.signedPdfSha256} is not null
      and ${table.signedPdfSha256} ~ '^[0-9a-f]{64}$'
      and ${table.signatureMethod} is not null
      and ${table.signaturePayload} is not null
      and jsonb_typeof(${table.signaturePayload}) = 'object'
      and ${table.signatoryName} is not null
      and length(trim(${table.signatoryName})) > 0
      and ${table.signatoryRole} is not null
      and ${table.finalizedById} is not null
      and ${table.finalizedAt} is not null
      and ${table.finalizedAt} >= ${table.signedAt}
    )`
  ),
}));

export const cycleConsentZones = pgTable("cycle_consent_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  consentId: uuid("consent_id").notNull(),
  zoneCode: text("zone_code").notNull().references(() => catalogZones.code),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  consentFk: foreignKey({
    name: "cycle_consent_zones_consent_fk",
    columns: [table.consentId, table.studioId],
    foreignColumns: [cycleConsents.id, cycleConsents.studioId],
  }).onDelete("restrict"),
  consentZoneUnique: uniqueIndex("cycle_consent_zones_consent_zone_unique").on(table.consentId, table.zoneCode),
  identity: uniqueIndex("cycle_consent_zones_identity").on(table.id, table.studioId),
  studioConsentIdx: index("cycle_consent_zones_studio_consent_idx").on(table.studioId, table.consentId),
  zoneIdx: index("cycle_consent_zones_zone_idx").on(table.zoneCode),
}));

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(),
  appointmentId: uuid("appointment_id"),
  cycleId: uuid("cycle_id"),
  type: text("type").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("EUR"),
  paymentMethod: text("payment_method"),
  targetPaymentId: uuid("target_payment_id"),
  reason: text("reason").notNull(),
  commandId: text("command_id"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  clientFk: foreignKey({
    name: "ledger_entries_client_fk",
    columns: [table.clientId, table.studioId],
    foreignColumns: [clients.id, clients.studioId],
  }).onDelete("restrict"),
  appointmentFk: foreignKey({
    name: "ledger_entries_appointment_fk",
    columns: [table.appointmentId, table.studioId, table.clientId],
    foreignColumns: [appointments.id, appointments.studioId, appointments.clientId],
  }).onDelete("restrict"),
  cycleFk: foreignKey({
    name: "ledger_entries_cycle_fk",
    columns: [table.cycleId, table.studioId],
    foreignColumns: [treatmentCycles.id, treatmentCycles.studioId],
  }).onDelete("restrict"),
  targetPaymentFk: foreignKey({
    name: "ledger_entries_target_payment_fk",
    columns: [table.targetPaymentId, table.studioId],
    foreignColumns: [table.id, table.studioId],
  }).onDelete("restrict"),
  identity: uniqueIndex("ledger_entries_identity").on(table.id, table.studioId),
  commandUnique: uniqueIndex("ledger_entries_command_unique").on(table.commandId).where(sql`${table.commandId} is not null`),
  studioIdx: index("ledger_entries_studio_idx").on(table.studioId),
  clientIdx: index("ledger_entries_client_idx").on(table.studioId, table.clientId),
  appointmentIdx: index("ledger_entries_appointment_idx").on(table.studioId, table.appointmentId),
  cycleIdx: index("ledger_entries_cycle_idx").on(table.studioId, table.cycleId),
  targetPaymentIdx: index("ledger_entries_target_payment_idx").on(table.studioId, table.targetPaymentId),
  typeCheck: check("ledger_entries_type_check", sql`${table.type} in ('CHARGE', 'PAYMENT', 'REFUND', 'ADJUSTMENT')`),
  currencyCheck: check("ledger_entries_currency_check", sql`${table.currency} = 'EUR'`),
  amountCheck: check("ledger_entries_amount_minor_check", sql`${table.amountMinor} <> 0`),
  reasonCheck: check("ledger_entries_reason_check", sql`length(trim(${table.reason})) > 0`),
  refundTargetCheck: check("ledger_entries_refund_target_check", sql`${table.type} != 'REFUND' or ${table.targetPaymentId} is not null or ${table.appointmentId} is not null or ${table.clientId} is not null`),
}));

export const CONVERSATION_STATUSES = ["OPEN", "CLOSED"] as const;
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = typeof MESSAGE_DIRECTIONS[number];

export const MESSAGE_CHANNELS = ["MANUAL", "WHATSAPP", "SMS", "EMAIL"] as const;
export type MessageChannel = typeof MESSAGE_CHANNELS[number];

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(),
  cycleId: uuid("cycle_id"),
  assignedUserId: text("assigned_user_id").references(() => user.id, { onDelete: "set null" }),
  status: text("status").$type<ConversationStatus>().notNull().default("OPEN"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  clientFk: foreignKey({
    name: "conversations_client_fk",
    columns: [table.clientId, table.studioId],
    foreignColumns: [clients.id, clients.studioId],
  }).onDelete("cascade"),
  cycleFk: foreignKey({
    name: "conversations_cycle_fk",
    columns: [table.cycleId, table.studioId],
    foreignColumns: [treatmentCycles.id, treatmentCycles.studioId],
  }).onDelete("set null"),
  identity: uniqueIndex("conversations_identity").on(table.id, table.studioId),
  studioClientUnique: uniqueIndex("conversations_studio_client_unique").on(table.studioId, table.clientId),
  studioIdx: index("conversations_studio_idx").on(table.studioId),
  clientIdx: index("conversations_client_idx").on(table.clientId),
  assignedUserIdx: index("conversations_assigned_user_idx").on(table.assignedUserId),
  lastMessageAtIdx: index("conversations_last_message_at_idx").on(table.studioId, table.lastMessageAt),
  statusCheck: check("conversations_status_check", sql`${table.status} in ('OPEN', 'CLOSED')`),
}));

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull(),
  clientId: uuid("client_id").notNull(),
  cycleId: uuid("cycle_id"),
  direction: text("direction").$type<MessageDirection>().notNull(),
  channel: text("channel").$type<MessageChannel>().notNull(),
  body: text("body").notNull(),
  senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
  providerMessageId: text("provider_message_id"),
  providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  conversationFk: foreignKey({
    name: "conversation_messages_conversation_fk",
    columns: [table.conversationId, table.studioId],
    foreignColumns: [conversations.id, conversations.studioId],
  }).onDelete("cascade"),
  clientFk: foreignKey({
    name: "conversation_messages_client_fk",
    columns: [table.clientId, table.studioId],
    foreignColumns: [clients.id, clients.studioId],
  }).onDelete("cascade"),
  cycleFk: foreignKey({
    name: "conversation_messages_cycle_fk",
    columns: [table.cycleId, table.studioId],
    foreignColumns: [treatmentCycles.id, treatmentCycles.studioId],
  }).onDelete("set null"),
  identity: uniqueIndex("conversation_messages_identity").on(table.id, table.studioId),
  studioConversationIdx: index("conversation_messages_studio_conversation_idx").on(table.studioId, table.conversationId, table.sentAt),
  studioClientIdx: index("conversation_messages_studio_client_idx").on(table.studioId, table.clientId, table.sentAt),
  providerMessageUnique: uniqueIndex("conversation_messages_provider_id_unique").on(table.studioId, table.providerMessageId).where(sql`${table.providerMessageId} is not null`),
  directionCheck: check("conversation_messages_direction_check", sql`${table.direction} in ('INBOUND', 'OUTBOUND')`),
  channelCheck: check("conversation_messages_channel_check", sql`${table.channel} in ('MANUAL', 'WHATSAPP', 'SMS', 'EMAIL')`),
  bodyCheck: check("conversation_messages_body_check", sql`length(trim(${table.body})) > 0`),
}));

export const conversationReadStates = pgTable("conversation_read_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  lastReadMessageId: uuid("last_read_message_id"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  conversationFk: foreignKey({
    name: "conversation_read_states_conversation_fk",
    columns: [table.conversationId, table.studioId],
    foreignColumns: [conversations.id, conversations.studioId],
  }).onDelete("cascade"),
  lastReadMessageFk: foreignKey({
    name: "conversation_read_states_message_fk",
    columns: [table.lastReadMessageId, table.studioId],
    foreignColumns: [conversationMessages.id, conversationMessages.studioId],
  }).onDelete("set null"),
  conversationUserUnique: uniqueIndex("conversation_read_states_user_unique").on(table.conversationId, table.userId),
  identity: uniqueIndex("conversation_read_states_identity").on(table.id, table.studioId),
  studioUserIdx: index("conversation_read_states_studio_user_idx").on(table.studioId, table.userId),
}));

export const AUTOMATION_TRIGGER_TYPES = [
  "APPOINTMENT_CREATED",
  "APPOINTMENT_RESCHEDULED",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_REMINDER_DUE",
  "PROCEDURE_COMPLETED",
  "CONVERSATION_INBOUND_RECEIVED",
  "CONVERSATION_FOLLOW_UP_DUE",
  "TREATMENT_CYCLE_STAGE_CHANGED",
  "MEDICAL_REVIEW_REQUIRED",
  "CONSENT_REQUIRED",
] as const;
export type AutomationTriggerType = typeof AUTOMATION_TRIGGER_TYPES[number];

export const AUTOMATION_ACTION_TYPES = [
  "CREATE_OPERATIONAL_REMINDER",
  "CREATE_CONVERSATION_FOLLOW_UP",
  "RECORD_INTERNAL_MESSAGE",
  "SURFACE_NEEDS_ATTENTION",
] as const;
export type AutomationActionType = typeof AUTOMATION_ACTION_TYPES[number];

export const AUTOMATION_EXECUTION_STATUSES = [
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type AutomationExecutionStatus = typeof AUTOMATION_EXECUTION_STATUSES[number];

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").default(true).notNull(),
  triggerType: text("trigger_type").$type<AutomationTriggerType>().notNull(),
  actionType: text("action_type").$type<AutomationActionType>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  studioCodeUnique: uniqueIndex("automation_rules_studio_code_unique").on(table.studioId, table.code),
  identity: uniqueIndex("automation_rules_identity").on(table.id, table.studioId),
  studioIdx: index("automation_rules_studio_idx").on(table.studioId, table.triggerType, table.enabled),
  codeCheck: check("automation_rules_code_check", sql`length(trim(${table.code})) >= 2`),
  nameCheck: check("automation_rules_name_check", sql`length(trim(${table.name})) >= 2`),
  triggerCheck: check("automation_rules_trigger_check", sql`${table.triggerType} in ('APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_REMINDER_DUE', 'PROCEDURE_COMPLETED', 'CONVERSATION_INBOUND_RECEIVED', 'CONVERSATION_FOLLOW_UP_DUE', 'TREATMENT_CYCLE_STAGE_CHANGED', 'MEDICAL_REVIEW_REQUIRED', 'CONSENT_REQUIRED')`),
  actionCheck: check("automation_rules_action_check", sql`${table.actionType} in ('CREATE_OPERATIONAL_REMINDER', 'CREATE_CONVERSATION_FOLLOW_UP', 'RECORD_INTERNAL_MESSAGE', 'SURFACE_NEEDS_ATTENTION')`),
}));

export const automationExecutions = pgTable("automation_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id"),
  jobId: uuid("job_id"),
  triggerType: text("trigger_type").$type<AutomationTriggerType>().notNull(),
  actionType: text("action_type").$type<AutomationActionType>().notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  status: text("status").$type<AutomationExecutionStatus>().default("scheduled").notNull(),
  attemptCount: integer("attempt_count").default(0).notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).defaultNow().notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  result: jsonb("result").$type<Record<string, unknown>>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  ruleFk: foreignKey({
    name: "automation_executions_rule_fk",
    columns: [table.ruleId, table.studioId],
    foreignColumns: [automationRules.id, automationRules.studioId],
  }).onDelete("set null"),
  identity: uniqueIndex("automation_executions_identity").on(table.id, table.studioId),
  studioCreatedAtIdx: index("automation_executions_studio_created_at_idx").on(table.studioId, table.createdAt),
  studioEntityIdx: index("automation_executions_studio_entity_idx").on(table.studioId, table.entityType, table.entityId),
  ruleStatusIdx: index("automation_executions_rule_status_idx").on(table.ruleId, table.status),
  jobIdIdx: index("automation_executions_job_id_idx").on(table.jobId),
  statusCheck: check("automation_executions_status_check", sql`${table.status} in ('scheduled', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')`),
}));

export const GOOGLE_CALENDAR_CONNECTION_STATUSES = [
  "connected",
  "needs_reauth",
  "sync_error",
  "disconnected",
] as const;
export type GoogleCalendarConnectionStatus = typeof GOOGLE_CALENDAR_CONNECTION_STATUSES[number];

export const GOOGLE_CALENDAR_SYNC_DIRECTIONS = [
  "two_way",
  "outbound_only",
] as const;
export type GoogleCalendarSyncDirection = typeof GOOGLE_CALENDAR_SYNC_DIRECTIONS[number];

export const GOOGLE_CALENDAR_SYNC_STATUSES = [
  "idle",
  "syncing",
  "error",
] as const;
export type GoogleCalendarSyncStatus = typeof GOOGLE_CALENDAR_SYNC_STATUSES[number];

export const GOOGLE_CALENDAR_MAPPING_STATUSES = [
  "synced",
  "pending",
  "failed",
  "deleted",
] as const;
export type GoogleCalendarMappingStatus = typeof GOOGLE_CALENDAR_MAPPING_STATUSES[number];

export const googleCalendarConnections = pgTable("google_calendar_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  masterId: uuid("master_id")
    .references(() => masters.id, { onDelete: "set null" }),
  googleAccountId: text("google_account_id"),
  googleEmail: text("google_email"),
  calendarId: text("calendar_id").notNull().default("primary"),
  calendarSummary: text("calendar_summary"),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scope: text("scope").notNull().default("https://www.googleapis.com/auth/calendar.events"),
  status: text("status").$type<GoogleCalendarConnectionStatus>().notNull().default("connected"),
  syncDirection: text("sync_direction").$type<GoogleCalendarSyncDirection>().notNull().default("two_way"),
  syncStatus: text("sync_status").$type<GoogleCalendarSyncStatus>().notNull().default("idle"),
  channelId: text("channel_id"),
  resourceId: text("resource_id"),
  channelExpiresAt: timestamp("channel_expires_at", { withTimezone: true }),
  syncToken: text("sync_token"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("google_calendar_connections_identity").on(table.id, table.studioId),
  masterFk: foreignKey({
    name: "google_calendar_connections_master_fk",
    columns: [table.masterId, table.studioId],
    foreignColumns: [masters.id, masters.studioId],
  }).onDelete("set null"),
  studioUserCalUnique: uniqueIndex("google_calendar_connections_studio_user_cal_unique").on(table.studioId, table.userId, table.calendarId),
  studioMasterCalUnique: uniqueIndex("google_calendar_connections_studio_master_cal_unique").on(table.studioId, table.masterId, table.calendarId),
  studioIdx: index("google_calendar_connections_studio_idx").on(table.studioId, table.status),
  statusCheck: check("google_calendar_connections_status_check", sql`${table.status} in ('connected', 'needs_reauth', 'sync_error', 'disconnected')`),
  syncDirectionCheck: check("google_calendar_connections_sync_direction_check", sql`${table.syncDirection} in ('two_way', 'outbound_only')`),
  syncStatusCheck: check("google_calendar_connections_sync_status_check", sql`${table.syncStatus} in ('idle', 'syncing', 'error')`),
}));

export const googleCalendarEventMappings = pgTable("google_calendar_event_mappings", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => googleCalendarConnections.id, { onDelete: "cascade" }),
  appointmentId: uuid("appointment_id")
    .notNull()
    .references(() => appointments.id, { onDelete: "cascade" }),
  googleEventId: text("google_event_id").notNull(),
  etag: text("etag"),
  lastSyncedHash: text("last_synced_hash").notNull(),
  status: text("status").$type<GoogleCalendarMappingStatus>().notNull().default("synced"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("google_calendar_event_mappings_identity").on(table.id, table.studioId),
  connectionFk: foreignKey({
    name: "google_calendar_event_mappings_connection_fk",
    columns: [table.connectionId, table.studioId],
    foreignColumns: [googleCalendarConnections.id, googleCalendarConnections.studioId],
  }).onDelete("cascade"),
  appointmentFk: foreignKey({
    name: "google_calendar_event_mappings_appointment_fk",
    columns: [table.appointmentId, table.studioId],
    foreignColumns: [appointments.id, appointments.studioId],
  }).onDelete("cascade"),
  connApptUnique: uniqueIndex("google_calendar_event_mappings_conn_appt_unique").on(table.connectionId, table.appointmentId),
  connEventUnique: uniqueIndex("google_calendar_event_mappings_conn_event_unique").on(table.connectionId, table.googleEventId),
  studioIdx: index("google_calendar_event_mappings_studio_idx").on(table.studioId, table.status),
  appointmentIdx: index("google_calendar_event_mappings_appointment_idx").on(table.appointmentId),
  statusCheck: check("google_calendar_event_mappings_status_check", sql`${table.status} in ('synced', 'pending', 'failed', 'deleted')`),
}));

export const AI_RUN_STATUSES = [
  "started",
  "completed",
  "failed",
] as const;
export type AiRunStatus = typeof AI_RUN_STATUSES[number];

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  studioId: uuid("studio_id")
    .notNull()
    .references(() => studios.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  feature: text("feature").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  status: text("status").$type<AiRunStatus>().notNull().default("started"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  requestKey: text("request_key"),
  result: jsonb("result"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  identity: uniqueIndex("ai_runs_identity").on(table.id, table.studioId),
  studioCreatedAtIdx: index("ai_runs_studio_created_at_idx").on(table.studioId, table.createdAt),
  studioEntityIdx: index("ai_runs_studio_entity_idx").on(table.studioId, table.entityType, table.entityId),
  studioFeatureIdx: index("ai_runs_studio_feature_idx").on(table.studioId, table.feature),
  requestKeyUnique: uniqueIndex("ai_runs_studio_request_key_unique").on(table.studioId, table.requestKey),
  statusCheck: check("ai_runs_status_check", sql`${table.status} in ('started', 'completed', 'failed')`),
}));

export const HANDOFF_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_SOURCE_TYPES = [
  "HUMAN",
  "AUTOMATION",
  "AI",
  "SYSTEM",
] as const;
export type HandoffSourceType = (typeof HANDOFF_SOURCE_TYPES)[number];

export const HANDOFF_ENTITY_TYPES = [
  "CLIENT",
  "TREATMENT_CYCLE",
  "CONVERSATION",
  "APPOINTMENT",
  "NEEDS_ATTENTION_ITEM",
] as const;
export type HandoffEntityType = (typeof HANDOFF_ENTITY_TYPES)[number];

export const HANDOFF_PRIORITIES = [
  "URGENT",
  "HIGH",
  "NORMAL",
  "LOW",
] as const;
export type HandoffPriority = (typeof HANDOFF_PRIORITIES)[number];

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    entityType: text("entity_type").$type<HandoffEntityType>().notNull(),
    entityId: text("entity_id").notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    cycleId: uuid("cycle_id").references(() => treatmentCycles.id, {
      onDelete: "set null",
    }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    fromUserId: text("from_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceType: text("source_type")
      .$type<HandoffSourceType>()
      .notNull()
      .default("HUMAN"),
    reasonCode: text("reason_code").notNull(),
    reasonText: text("reason_text"),
    status: text("status")
      .$type<HandoffStatus>()
      .notNull()
      .default("PENDING"),
    priority: text("priority")
      .$type<HandoffPriority>()
      .notNull()
      .default("NORMAL"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    requestKey: text("request_key"),
    metadata: jsonb("metadata"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedById: text("accepted_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    rejectionReason: text("rejection_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: text("completed_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledById: text("cancelled_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    cancellationReason: text("cancellation_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    identity: uniqueIndex("handoffs_identity").on(table.id, table.studioId),
    clientFk: foreignKey({
      name: "handoffs_client_studio_fk",
      columns: [table.clientId, table.studioId],
      foreignColumns: [clients.id, clients.studioId],
    }).onDelete("set null"),
    cycleFk: foreignKey({
      name: "handoffs_cycle_studio_fk",
      columns: [table.cycleId, table.studioId],
      foreignColumns: [treatmentCycles.id, treatmentCycles.studioId],
    }).onDelete("set null"),
    conversationFk: foreignKey({
      name: "handoffs_conversation_studio_fk",
      columns: [table.conversationId, table.studioId],
      foreignColumns: [conversations.id, conversations.studioId],
    }).onDelete("set null"),
    appointmentFk: foreignKey({
      name: "handoffs_appointment_studio_fk",
      columns: [table.appointmentId, table.studioId],
      foreignColumns: [appointments.id, appointments.studioId],
    }).onDelete("set null"),
    requestKeyUnique: uniqueIndex("handoffs_studio_request_key_unique").on(
      table.studioId,
      table.requestKey
    ),
    activeEntityPendingUnique: uniqueIndex("handoffs_active_entity_unique")
      .on(table.studioId, table.entityType, table.entityId)
      .where(sql`${table.status} = 'PENDING'`),
    studioStatusToUserIdx: index("handoffs_studio_status_to_user_idx").on(
      table.studioId,
      table.status,
      table.toUserId
    ),
    studioDueAtIdx: index("handoffs_studio_due_at_idx").on(
      table.studioId,
      table.dueAt
    ),
    studioCreatedAtIdx: index("handoffs_studio_created_at_idx").on(
      table.studioId,
      table.createdAt
    ),
    studioEntityIdx: index("handoffs_studio_entity_idx").on(
      table.studioId,
      table.entityType,
      table.entityId
    ),
    statusCheck: check(
      "handoffs_status_check",
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED')`
    ),
    sourceTypeCheck: check(
      "handoffs_source_type_check",
      sql`${table.sourceType} in ('HUMAN', 'AUTOMATION', 'AI', 'SYSTEM')`
    ),
    priorityCheck: check(
      "handoffs_priority_check",
      sql`${table.priority} in ('URGENT', 'HIGH', 'NORMAL', 'LOW')`
    ),
    entityTypeCheck: check(
      "handoffs_entity_type_check",
      sql`${table.entityType} in ('CLIENT', 'TREATMENT_CYCLE', 'CONVERSATION', 'APPOINTMENT', 'NEEDS_ATTENTION_ITEM')`
    ),
  })
);

export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerName: text("worker_name").notNull(),
    instanceId: text("instance_id").notNull(),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    version: text("version").default("1.0.0").notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    workerInstanceUnique: uniqueIndex("worker_heartbeats_worker_instance_idx").on(
      table.workerName,
      table.instanceId
    ),
    lastHeartbeatIdx: index("worker_heartbeats_last_heartbeat_idx").on(
      table.lastHeartbeat
    ),
  })
);

export type PrivacyRequestType = "EXPORT" | "ANONYMIZE" | "DELETE_WHERE_ALLOWED";
export type PrivacyRequestStatus =
  | "REQUESTED"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    requestType: text("request_type").$type<PrivacyRequestType>().notNull(),
    status: text("status")
      .$type<PrivacyRequestStatus>()
      .notNull()
      .default("REQUESTED"),
    requestedById: text("requested_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    approvedById: text("approved_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    commandId: text("command_id"),
    exportArtifactId: uuid("export_artifact_id").references(() => media.id, {
      onDelete: "set null",
    }),
    exportExpiresAt: timestamp("export_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    clientFk: foreignKey({
      name: "privacy_requests_client_studio_fk",
      columns: [table.clientId, table.studioId],
      foreignColumns: [clients.id, clients.studioId],
    }).onDelete("cascade"),
    studioClientIdx: index("privacy_requests_studio_client_idx").on(
      table.studioId,
      table.clientId
    ),
    studioStatusIdx: index("privacy_requests_studio_status_idx").on(
      table.studioId,
      table.status
    ),
    studioCreatedAtIdx: index("privacy_requests_studio_created_at_idx").on(
      table.studioId,
      table.createdAt
    ),
    commandIdUnique: uniqueIndex("privacy_requests_command_id_idx").on(
      table.commandId
    ),
    requestTypeCheck: check(
      "privacy_requests_type_check",
      sql`${table.requestType} in ('EXPORT', 'ANONYMIZE', 'DELETE_WHERE_ALLOWED')`
    ),
    statusCheck: check(
      "privacy_requests_status_check",
      sql`${table.status} in ('REQUESTED', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`
    ),
  })
);

export const studioPrivacyRetentionPolicies = pgTable(
  "studio_privacy_retention_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studioId: uuid("studio_id")
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
    temporaryUploadRetentionDays: integer("temporary_upload_retention_days")
      .default(7)
      .notNull(),
    privacyExportRetentionDays: integer("privacy_export_retention_days")
      .default(30)
      .notNull(),
    orphanMediaGraceDays: integer("orphan_media_grace_days")
      .default(14)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    studioIdUnique: uniqueIndex("studio_retention_policies_studio_id_unique").on(
      table.studioId
    ),
    tempUploadCheck: check(
      "studio_retention_policies_temp_check",
      sql`${table.temporaryUploadRetentionDays} > 0`
    ),
    exportRetentionCheck: check(
      "studio_retention_policies_export_check",
      sql`${table.privacyExportRetentionDays} > 0`
    ),
    orphanGraceCheck: check(
      "studio_retention_policies_orphan_check",
      sql`${table.orphanMediaGraceDays} > 0`
    ),
  })
);
