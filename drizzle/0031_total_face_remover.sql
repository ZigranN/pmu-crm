ALTER TABLE "treatment_packages" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_packages" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "treatment_packages" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treatment_packages" DROP CONSTRAINT "treatment_packages_contract";--> statement-breakpoint
ALTER TABLE "treatment_packages" ADD CONSTRAINT "treatment_packages_contract" CHECK ("treatment_packages"."kind" = 'total_face' and "treatment_packages"."status" in ('active', 'completed', 'archived') and "treatment_packages"."version" > 0 and ("treatment_packages"."commercial_snapshot" is null or jsonb_typeof("treatment_packages"."commercial_snapshot") = 'object'));--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'appointment.read', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read', 'finance.summary', 'ledger.list', 'procedures.list', 'procedure.read', 'procedures.history', 'packages.list', 'package.read', 'packages.summary'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action"
      when 'procedure_started' then 'procedure_session'
      when 'procedure_completed' then 'procedure_session'
      when 'procedure_aborted' then 'procedure_session'
      when 'procedure_evidence_updated' then 'procedure_session'
      when 'consent_template_created' then 'consent_template'
      when 'consent_template_version_published' then 'consent_template_version'
      when 'consent_template_archived' then 'consent_template'
      when 'cycle_consent_signed' then 'cycle_consent'
      when 'medical_clearance_recorded' then 'cycle_medical_clearance'
      when 'commercial_terms_confirmed' then 'cycle_commercial_terms'
      when 'cycle_qualified' then 'treatment_cycle'
      when 'consultation_completed' then 'treatment_cycle'
      when 'consultation_result_recorded' then 'treatment_cycle'
      when 'cycle_created' then 'treatment_cycle'
      when 'cycle_stage_changed' then 'treatment_cycle'
      when 'total_face_package_created' then 'treatment_package'
      when 'total_face_package_completed' then 'treatment_package'
      when 'remover_cycle_created' then 'treatment_cycle'
      when 'client_merged' then 'client'
      when 'client_duplicate_accepted' then 'client'
      when 'client_preferred_master_changed' then 'client'
      when 'master_price_changed' then 'master_price_revision'
      when 'offer_created' then 'offer_revision'
      when 'offer_revised' then 'offer_revision'
      when 'service_consolidated' then 'service'
      when 'job_recovered' then 'outbox_job'
      when 'client_created' then 'client'
      when 'client_updated' then 'client'
      when 'client_status_changed' then 'client'
      when 'client_archived' then 'client'
      when 'client_restored' then 'client'
      when 'client_master_assigned' then 'client'
      when 'medical_profile_updated' then 'client_medical_profile'
      when 'media_uploaded' then 'media'
      when 'media_archived' then 'media'
      when 'consent_uploaded' then 'consent'
      when 'consent_archived' then 'consent'
      when 'service_created' then 'service'
      when 'service_updated' then 'service'
      when 'service_archived' then 'service'
      when 'service_restored' then 'service'
      when 'master_created' then 'master'
      when 'master_updated' then 'master'
      when 'master_archived' then 'master'
      when 'master_restored' then 'master'
      when 'studio_settings_updated' then 'studio'
      when 'membership_changed' then 'studio_member'
      when 'appointment_created' then 'appointment'
      when 'appointment_rescheduled' then 'appointment'
      when 'appointment_cancelled' then 'appointment'
      when 'payment_recorded' then 'ledger_entry'
      when 'refund_recorded' then 'ledger_entry'
      when 'ledger_adjustment_recorded' then 'ledger_entry'
      when 'charge_recorded' then 'ledger_entry'
      else '__invalid__' end
    and "audit_logs"."action" in ('procedure_started', 'procedure_completed', 'procedure_aborted', 'procedure_evidence_updated', 'consent_template_created', 'consent_template_version_published', 'consent_template_archived', 'cycle_consent_signed', 'medical_clearance_recorded', 'commercial_terms_confirmed', 'cycle_qualified', 'consultation_completed', 'consultation_result_recorded', 'cycle_created', 'cycle_stage_changed', 'total_face_package_created', 'total_face_package_completed', 'remover_cycle_created', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed', 'appointment_created', 'appointment_rescheduled', 'appointment_cancelled', 'payment_recorded', 'refund_recorded', 'ledger_adjustment_recorded', 'charge_recorded')));--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_cycle_history_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts r WHERE r.id=NEW.command_id AND r.studio_id=NEW.studio_id AND r.actor_id=NEW.actor_id AND (
   (r.command IN ('cycle.create.v1','cycle.transition.v1','remover.create.v1') AND r.result->>'id'=NEW.cycle_id::text AND (r.result->>'version')::integer=NEW.version)
   OR (r.command='total-face.create.v1' AND NEW.version=1 AND NEW.from_stage IS NULL AND NEW.to_stage='new_lead' AND r.result->'cycleIds' ? NEW.cycle_id::text)
   OR (r.command IN ('cycle.qualify.v1','consultation.complete.v1','consultation.result.v1','cycle.follow-up-reschedule.v1','cycle.review.v1') AND r.result->>'id'=NEW.cycle_id::text AND NEW.version>(r.result->>'fromVersion')::integer AND NEW.version<=(r.result->>'version')::integer)
   OR (r.command='consultation.result.v1' AND r.result->>'removerCycleId'=NEW.cycle_id::text AND NEW.version=1 AND NEW.from_stage IS NULL AND NEW.to_stage='new_lead')
   OR (r.command='procedure.complete.v1' AND (r.result->>'cycleId'=NEW.cycle_id::text OR r.result->>'id'=NEW.cycle_id::text))
 )) THEN RAISE EXCEPTION 'Cycle history requires matching command receipt'; END IF;
 RETURN NEW;
END;
$$;
