CREATE TABLE "client_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"review_token" text NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"target_snapshot" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"moved_records" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_merges_check" CHECK ("client_merges"."source_id" != "client_merges"."target_id" and length(trim("client_merges"."reason")) >= 3)
);
--> statement-breakpoint
ALTER TABLE "client_medical_profiles" DROP CONSTRAINT "client_medical_profiles_client_id_unique";--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
DROP INDEX "client_duplicate_decision_client_unique";--> statement-breakpoint
ALTER TABLE "client_medical_profiles" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_medical_profiles" ADD COLUMN "merge_review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "client_merges" ADD CONSTRAINT "client_merges_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_merges" ADD CONSTRAINT "client_merges_source_id_studio_id_clients_id_studio_id_fk" FOREIGN KEY ("source_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_merges" ADD CONSTRAINT "client_merges_target_id_studio_id_clients_id_studio_id_fk" FOREIGN KEY ("target_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_merges_source_unique" ON "client_merges" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merge_target_studio_fk" FOREIGN KEY ("merged_into_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_duplicate_decision_client_idx" ON "client_duplicate_decisions" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_medical_active_unique" ON "client_medical_profiles" USING btree ("client_id") WHERE "client_medical_profiles"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "clients_merge_target_idx" ON "clients" USING btree ("studio_id","merged_into_id");--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merge_check" CHECK ("clients"."merged_into_id" is null or ("clients"."merged_into_id" != "clients"."id" and "clients"."deleted_at" is not null));
--> statement-breakpoint
CREATE TRIGGER client_merge_history_immutable BEFORE UPDATE OR DELETE ON client_merges FOR EACH ROW EXECUTE FUNCTION pmu_reject_pricing_history_change();
--> statement-breakpoint
DROP TRIGGER offer_identity_immutable ON custom_offers;
--> statement-breakpoint
CREATE FUNCTION pmu_guard_offer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'client_id') = (to_jsonb(OLD) - 'client_id')
    AND EXISTS (SELECT 1 FROM client_merges m WHERE m.source_id = OLD.client_id AND m.target_id = NEW.client_id
      AND m.studio_id = OLD.studio_id AND m.xmin = pg_current_xact_id()::text::xid)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Offer identity changes require an atomic client merge';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER offer_identity_immutable BEFORE UPDATE OR DELETE ON custom_offers FOR EACH ROW EXECUTE FUNCTION pmu_guard_offer_identity();
