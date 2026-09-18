CREATE TABLE "cycle_commercial_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"cycle_version" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"source" text NOT NULL,
	"service_id" uuid NOT NULL,
	"master_id" uuid,
	"offer_item_id" uuid,
	"amount_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_terms_contract" CHECK ("cycle_commercial_terms"."revision">0 and "cycle_commercial_terms"."cycle_version">0 and "cycle_commercial_terms"."currency"='EUR' and "cycle_commercial_terms"."review_at">"cycle_commercial_terms"."confirmed_at" and length(trim("cycle_commercial_terms"."reason")) between 3 and 1000 and jsonb_typeof("cycle_commercial_terms"."source_snapshot")='object' and (("cycle_commercial_terms"."source"='catalog' and "cycle_commercial_terms"."offer_item_id" is null and "cycle_commercial_terms"."amount_cents" is not null and "cycle_commercial_terms"."amount_cents">=0) or ("cycle_commercial_terms"."source"='offer' and "cycle_commercial_terms"."offer_item_id" is not null and "cycle_commercial_terms"."amount_cents" is null)))
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "cycle_commercial_terms" ADD CONSTRAINT "cycle_commercial_terms_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_commercial_terms" ADD CONSTRAINT "cycle_commercial_terms_offer_item_id_offer_items_id_fk" FOREIGN KEY ("offer_item_id") REFERENCES "public"."offer_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_commercial_terms" ADD CONSTRAINT "commercial_terms_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_commercial_terms" ADD CONSTRAINT "commercial_terms_service_fk" FOREIGN KEY ("service_id","studio_id") REFERENCES "public"."services"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_commercial_terms" ADD CONSTRAINT "commercial_terms_master_fk" FOREIGN KEY ("master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_terms_revision_unique" ON "cycle_commercial_terms" USING btree ("cycle_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_terms_command_unique" ON "cycle_commercial_terms" USING btree ("command_id");--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'commercial_terms_confirmed' then 'cycle_commercial_terms' when 'cycle_qualified' then 'treatment_cycle' when 'consultation_completed' then 'treatment_cycle' when 'consultation_result_recorded' then 'treatment_cycle' when 'cycle_created' then 'treatment_cycle' when 'cycle_stage_changed' then 'treatment_cycle' when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('commercial_terms_confirmed', 'cycle_qualified', 'consultation_completed', 'consultation_result_recorded', 'cycle_created', 'cycle_stage_changed', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));--> statement-breakpoint
ALTER TABLE cycle_commercial_terms ADD CONSTRAINT commercial_terms_receipt_fk FOREIGN KEY (command_id) REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TRIGGER commercial_terms_immutable BEFORE UPDATE OR DELETE ON cycle_commercial_terms FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_immutable();
--> statement-breakpoint
CREATE FUNCTION pmu_commercial_terms_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts r WHERE r.id=NEW.command_id AND r.studio_id=NEW.studio_id AND r.actor_id=NEW.actor_id AND r.command='cycle.terms-confirm.v1' AND r.result->>'id'=NEW.id::text AND r.result->>'cycleId'=NEW.cycle_id::text AND (r.result->>'revision')::integer=NEW.revision)
 THEN RAISE EXCEPTION 'Commercial terms require matching command receipt'; END IF;
 IF NEW.source='offer' AND NOT EXISTS (
   SELECT 1 FROM offer_items i JOIN offer_revisions r ON r.id=i.revision_id JOIN custom_offers o ON o.id=r.offer_id JOIN treatment_cycles c ON c.id=NEW.cycle_id
   WHERE i.id=NEW.offer_item_id AND i.studio_id=NEW.studio_id AND o.client_id=c.client_id AND i.zone_code=c.zone_code AND i.service_id=NEW.service_id AND i.master_id IS NOT DISTINCT FROM NEW.master_id
 ) THEN RAISE EXCEPTION 'Commercial terms require matching offer item'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commercial_terms_guard AFTER INSERT ON cycle_commercial_terms DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_commercial_terms_guard();
