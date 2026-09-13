CREATE FUNCTION pmu_phone_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN value ~ '^[+0-9[:space:]().-]+$' AND length(value) <= 200 AND normalized ~ '^\+[1-9][0-9]{6,14}$' THEN normalized ELSE NULL END
 FROM (SELECT regexp_replace(regexp_replace(btrim(value), '[[:space:]().-]', '', 'g'), '^00', '+') AS normalized) p;
$$;
--> statement-breakpoint
CREATE FUNCTION pmu_email_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN length(normalized) <= 320 AND normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN normalized ELSE NULL END
 FROM (SELECT lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS normalized) e;
$$;
--> statement-breakpoint
CREATE FUNCTION pmu_instagram_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN normalized ~ '^[a-z0-9_][a-z0-9_.]{0,29}$' AND right(normalized,1) != '.' AND position('..' in normalized) = 0 THEN normalized ELSE NULL END
 FROM (SELECT regexp_replace(regexp_replace(regexp_replace(lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g')), '^https?://(www\.)?instagram\.com/', ''), '^@', ''), '/$', '') AS normalized) i;
$$;
--> statement-breakpoint
CREATE FUNCTION pmu_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT lower(btrim(regexp_replace(value, '[[:space:]]+', ' ', 'g')));
$$;
--> statement-breakpoint
CREATE TABLE "client_duplicate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"review_token" text NOT NULL,
	"matches" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_duplicate_decision_reason_check" CHECK (length(trim("client_duplicate_decisions"."reason")) >= 3)
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "phone_key" text GENERATED ALWAYS AS (pmu_phone_key(phone)) STORED;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "whatsapp_key" text GENERATED ALWAYS AS (pmu_phone_key(whatsapp)) STORED;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "email_key" text GENERATED ALWAYS AS (pmu_email_key(email)) STORED;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "instagram_key" text GENERATED ALWAYS AS (pmu_instagram_key(instagram)) STORED;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "name_key" text GENERATED ALWAYS AS (pmu_name_key(full_name)) STORED;--> statement-breakpoint
ALTER TABLE "client_duplicate_decisions" ADD CONSTRAINT "client_duplicate_decisions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_duplicate_decisions" ADD CONSTRAINT "client_duplicate_decisions_client_id_studio_id_clients_id_studio_id_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_duplicate_decision_client_unique" ON "client_duplicate_decisions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_studio_phone_key_idx" ON "clients" USING btree ("studio_id","phone_key");--> statement-breakpoint
CREATE INDEX "clients_studio_whatsapp_key_idx" ON "clients" USING btree ("studio_id","whatsapp_key");--> statement-breakpoint
CREATE INDEX "clients_studio_email_key_idx" ON "clients" USING btree ("studio_id","email_key");--> statement-breakpoint
CREATE INDEX "clients_studio_instagram_key_idx" ON "clients" USING btree ("studio_id","instagram_key");--> statement-breakpoint
CREATE INDEX "clients_studio_name_key_idx" ON "clients" USING btree ("studio_id","name_key");--> statement-breakpoint
CREATE INDEX "clients_studio_name_prefix_idx" ON "clients" USING btree ("studio_id",left("name_key", 3));--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));