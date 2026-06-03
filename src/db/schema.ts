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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
});

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
});

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
});

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

export const services = pgTable(
    "services",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        studioId: uuid("studio_id")
            .notNull()
            .references(() => studios.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        description: text("description"),
        category: serviceCategoryEnum("category").notNull(),
        procedureType: procedureTypeEnum("procedure_type").notNull(),
        priceCents: integer("price_cents").notNull(),
        durationMinutes: integer("duration_minutes").notNull(),
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
        studioIdIdx: index("clients_studio_id_idx").on(table.studioId),
        phoneIdx: index("clients_phone_idx").on(table.phone),
        whatsappIdx: index("clients_whatsapp_idx").on(table.whatsapp),
        emailIdx: index("clients_email_idx").on(table.email),
        fullNameIdx: index("clients_full_name_idx").on(table.fullName),
    })
);

export const clientMedicalProfiles = pgTable("client_medical_profiles", {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
        .notNull()
        .unique()
        .references(() => clients.id, { onDelete: "cascade" }),
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
});


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

export const procedureSessions = pgTable(
    "procedure_sessions",
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
        masterId: uuid("master_id")
            .notNull()
            .references(() => masters.id),
        serviceId: uuid("service_id")
            .notNull()
            .references(() => services.id),
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
        clientIdIdx: index("procedure_sessions_client_id_idx").on(table.clientId),
        masterIdIdx: index("procedure_sessions_master_id_idx").on(table.masterId),
        painLevelCheck: check(
            "procedure_sessions_pain_level_check",
            sql`${table.painLevel} IS NULL OR (${table.painLevel} >= 0 AND ${table.painLevel} <= 10)`
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
});

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
});

export const tasks = pgTable(
    "tasks",
    {
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
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
