CREATE TABLE "cycle_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"version" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_stage_history_contract" CHECK ("cycle_stage_history"."version" > 0 and length(trim("cycle_stage_history"."reason")) between 3 and 1000
    and "cycle_stage_history"."to_stage" in ('new_lead','qualification','consultation_needed','consultation_offered','consultation_scheduled','consultation_confirmed','consultation_completed','consultation_result_required','consultation_result','thinking','procedure_slot_selected','awaiting_acconto','procedure_confirmed','first_session_completed','second_session_scheduled','second_session_completed','control_scheduled','cycle_completed','refresh_offered','refresh_no_response','lost')
    and ("cycle_stage_history"."from_stage" is null or "cycle_stage_history"."from_stage" in ('new_lead','qualification','consultation_needed','consultation_offered','consultation_scheduled','consultation_confirmed','consultation_completed','consultation_result_required','consultation_result','thinking','procedure_slot_selected','awaiting_acconto','procedure_confirmed','first_session_completed','second_session_scheduled','second_session_completed','control_scheduled','cycle_completed','refresh_offered','refresh_no_response','lost')))
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_cycles_studio_identity" ON "treatment_cycles" USING btree ("id","studio_id");
--> statement-breakpoint
ALTER TABLE "cycle_stage_history" ADD CONSTRAINT "cycle_stage_history_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_stage_history" ADD CONSTRAINT "cycle_stage_history_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_stage_history" ADD CONSTRAINT "cycle_stage_history_command_fk" FOREIGN KEY ("command_id") REFERENCES "public"."command_receipts"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_stage_history_version_unique" ON "cycle_stage_history" USING btree ("cycle_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_stage_history_command_unique" ON "cycle_stage_history" USING btree ("command_id");--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'cycle_created' then 'treatment_cycle' when 'cycle_stage_changed' then 'treatment_cycle' when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('cycle_created', 'cycle_stage_changed', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));
--> statement-breakpoint
CREATE FUNCTION pmu_cycle_stage_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage IS DISTINCT FROM OLD.stage THEN
   IF NEW.version != OLD.version + 1 OR NOT EXISTS (
     SELECT 1 FROM cycle_stage_history h WHERE h.cycle_id = NEW.id AND h.studio_id = NEW.studio_id
       AND h.version = NEW.version AND h.from_stage = OLD.stage AND h.to_stage = NEW.stage
   ) THEN RAISE EXCEPTION 'Stage change requires versioned command history'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cycle_stage_evidence AFTER UPDATE ON treatment_cycles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_cycle_stage_evidence();
--> statement-breakpoint
CREATE FUNCTION pmu_cycle_history_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts r WHERE r.id = NEW.command_id AND r.studio_id = NEW.studio_id AND r.actor_id = NEW.actor_id
   AND r.command IN ('cycle.create.v1','cycle.transition.v1') AND r.result->>'id' = NEW.cycle_id::text AND (r.result->>'version')::integer = NEW.version)
 THEN RAISE EXCEPTION 'Cycle history requires matching command receipt'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cycle_history_receipt AFTER INSERT ON cycle_stage_history DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_receipt();
--> statement-breakpoint
CREATE FUNCTION pmu_cycle_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Cycle stage history is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cycle_history_immutable BEFORE UPDATE OR DELETE ON cycle_stage_history FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_immutable();
