ALTER TYPE "public"."activity_event_type" ADD VALUE 'client_status_changed' BEFORE 'medical_profile_updated';--> statement-breakpoint
ALTER TYPE "public"."activity_event_type" ADD VALUE 'client_master_assigned' BEFORE 'medical_profile_updated';--> statement-breakpoint
ALTER TYPE "public"."activity_event_type" ADD VALUE 'client_archived' BEFORE 'medical_profile_updated';--> statement-breakpoint
ALTER TYPE "public"."activity_event_type" ADD VALUE 'client_restored' BEFORE 'medical_profile_updated';--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"target_id" text,
	"result" text NOT NULL,
	"record_ids" jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list')),
	CONSTRAINT "access_logs_result_check" CHECK ("access_logs"."result" in ('returned', 'not_returned', 'denied', 'error')),
	CONSTRAINT "access_logs_count_check" CHECK ("access_logs"."record_count" >= 0 and jsonb_typeof("access_logs"."record_ids") = 'array' and jsonb_array_length("access_logs"."record_ids") = "access_logs"."record_count")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "contract_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Preserve historical rows as legacy; all subsequent writes use the new contract.
ALTER TABLE "audit_logs" ALTER COLUMN "contract_version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "old_values" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "new_values" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason_source" text;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_logs_studio_time_idx" ON "access_logs" USING btree ("studio_id","created_at","id");--> statement-breakpoint
CREATE INDEX "access_logs_actor_time_idx" ON "access_logs" USING btree ("studio_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_studio_time_idx" ON "audit_logs" USING btree ("studio_id","created_at","id");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));