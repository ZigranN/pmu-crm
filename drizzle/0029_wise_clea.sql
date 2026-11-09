CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"appointment_id" uuid,
	"cycle_id" uuid,
	"type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"payment_method" text,
	"target_payment_id" uuid,
	"reason" text NOT NULL,
	"command_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_type_check" CHECK ("ledger_entries"."type" in ('CHARGE', 'PAYMENT', 'REFUND', 'ADJUSTMENT')),
	CONSTRAINT "ledger_entries_currency_check" CHECK ("ledger_entries"."currency" = 'EUR'),
	CONSTRAINT "ledger_entries_amount_minor_check" CHECK ("ledger_entries"."amount_minor" <> 0),
	CONSTRAINT "ledger_entries_reason_check" CHECK (length(trim("ledger_entries"."reason")) > 0),
	CONSTRAINT "ledger_entries_refund_target_check" CHECK ("ledger_entries"."type" != 'REFUND' or "ledger_entries"."target_payment_id" is not null or "ledger_entries"."appointment_id" is not null or "ledger_entries"."client_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_appointment_fk" FOREIGN KEY ("appointment_id","studio_id","client_id") REFERENCES "public"."appointments"("id","studio_id","client_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_identity" ON "ledger_entries" USING btree ("id","studio_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_target_payment_fk" FOREIGN KEY ("target_payment_id","studio_id") REFERENCES "public"."ledger_entries"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_command_unique" ON "ledger_entries" USING btree ("command_id") WHERE "ledger_entries"."command_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_studio_idx" ON "ledger_entries" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_client_idx" ON "ledger_entries" USING btree ("studio_id","client_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_appointment_idx" ON "ledger_entries" USING btree ("studio_id","appointment_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_cycle_idx" ON "ledger_entries" USING btree ("studio_id","cycle_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_target_payment_idx" ON "ledger_entries" USING btree ("studio_id","target_payment_id");--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'appointment.read', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read', 'finance.summary', 'ledger.list'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'consent_template_created' then 'consent_template' when 'consent_template_version_published' then 'consent_template_version' when 'consent_template_archived' then 'consent_template' when 'cycle_consent_signed' then 'cycle_consent' when 'medical_clearance_recorded' then 'cycle_medical_clearance' when 'commercial_terms_confirmed' then 'cycle_commercial_terms' when 'cycle_qualified' then 'treatment_cycle' when 'consultation_completed' then 'treatment_cycle' when 'consultation_result_recorded' then 'treatment_cycle' when 'cycle_created' then 'treatment_cycle' when 'cycle_stage_changed' then 'treatment_cycle' when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' when 'appointment_created' then 'appointment' when 'appointment_rescheduled' then 'appointment' when 'appointment_cancelled' then 'appointment' when 'payment_recorded' then 'ledger_entry' when 'refund_recorded' then 'ledger_entry' when 'ledger_adjustment_recorded' then 'ledger_entry' when 'charge_recorded' then 'ledger_entry' else '__invalid__' end
    and "audit_logs"."action" in ('consent_template_created', 'consent_template_version_published', 'consent_template_archived', 'cycle_consent_signed', 'medical_clearance_recorded', 'commercial_terms_confirmed', 'cycle_qualified', 'consultation_completed', 'consultation_result_recorded', 'cycle_created', 'cycle_stage_changed', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed', 'appointment_created', 'appointment_rescheduled', 'appointment_cancelled', 'payment_recorded', 'refund_recorded', 'ledger_adjustment_recorded', 'charge_recorded')));
--> statement-breakpoint
CREATE FUNCTION pmu_reject_ledger_entry_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Ledger entries are immutable; financial facts cannot be updated or deleted';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION pmu_reject_ledger_entry_change();