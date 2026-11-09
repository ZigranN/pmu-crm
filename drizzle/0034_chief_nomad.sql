CREATE TABLE "google_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"master_id" uuid,
	"google_account_id" text,
	"google_email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"calendar_summary" text,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scope" text DEFAULT 'https://www.googleapis.com/auth/calendar.events' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"sync_direction" text DEFAULT 'two_way' NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"channel_id" text,
	"resource_id" text,
	"channel_expires_at" timestamp with time zone,
	"sync_token" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_connections_status_check" CHECK ("google_calendar_connections"."status" in ('connected', 'needs_reauth', 'sync_error', 'disconnected')),
	CONSTRAINT "google_calendar_connections_sync_direction_check" CHECK ("google_calendar_connections"."sync_direction" in ('two_way', 'outbound_only')),
	CONSTRAINT "google_calendar_connections_sync_status_check" CHECK ("google_calendar_connections"."sync_status" in ('idle', 'syncing', 'error'))
);
--> statement-breakpoint
CREATE TABLE "google_calendar_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"etag" text,
	"last_synced_hash" text NOT NULL,
	"status" text DEFAULT 'synced' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_event_mappings_status_check" CHECK ("google_calendar_event_mappings"."status" in ('synced', 'pending', 'failed', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_id_studio_unique" ON "appointments" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_identity" ON "google_calendar_connections" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_studio_user_cal_unique" ON "google_calendar_connections" USING btree ("studio_id","user_id","calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_studio_master_cal_unique" ON "google_calendar_connections" USING btree ("studio_id","master_id","calendar_id");--> statement-breakpoint
CREATE INDEX "google_calendar_connections_studio_idx" ON "google_calendar_connections" USING btree ("studio_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_mappings_identity" ON "google_calendar_event_mappings" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_mappings_conn_appt_unique" ON "google_calendar_event_mappings" USING btree ("connection_id","appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_mappings_conn_event_unique" ON "google_calendar_event_mappings" USING btree ("connection_id","google_event_id");--> statement-breakpoint
CREATE INDEX "google_calendar_event_mappings_studio_idx" ON "google_calendar_event_mappings" USING btree ("studio_id","status");--> statement-breakpoint
CREATE INDEX "google_calendar_event_mappings_appointment_idx" ON "google_calendar_event_mappings" USING btree ("appointment_id");--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_master_fk" FOREIGN KEY ("master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_event_mappings" ADD CONSTRAINT "google_calendar_event_mappings_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_event_mappings" ADD CONSTRAINT "google_calendar_event_mappings_connection_fk" FOREIGN KEY ("connection_id","studio_id") REFERENCES "public"."google_calendar_connections"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_event_mappings" ADD CONSTRAINT "google_calendar_event_mappings_appointment_fk" FOREIGN KEY ("appointment_id","studio_id") REFERENCES "public"."appointments"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'appointment.read', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read', 'finance.summary', 'ledger.list', 'procedures.list', 'procedure.read', 'procedures.history', 'packages.list', 'package.read', 'packages.summary', 'conversations.list', 'conversation.read', 'conversations.messages', 'automations.list', 'automations.read', 'automation.rules.manage', 'google_calendar.connections.list', 'google_calendar.connection.read', 'google_calendar.events.list'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'procedure_started' then 'procedure_session' when 'procedure_completed' then 'procedure_session' when 'procedure_aborted' then 'procedure_session' when 'procedure_evidence_updated' then 'procedure_session' when 'consent_template_created' then 'consent_template' when 'consent_template_version_published' then 'consent_template_version' when 'consent_template_archived' then 'consent_template' when 'cycle_consent_signed' then 'cycle_consent' when 'medical_clearance_recorded' then 'cycle_medical_clearance' when 'commercial_terms_confirmed' then 'cycle_commercial_terms' when 'cycle_qualified' then 'treatment_cycle' when 'consultation_completed' then 'treatment_cycle' when 'consultation_result_recorded' then 'treatment_cycle' when 'cycle_created' then 'treatment_cycle' when 'cycle_stage_changed' then 'treatment_cycle' when 'total_face_package_created' then 'treatment_package' when 'total_face_package_completed' then 'treatment_package' when 'remover_cycle_created' then 'treatment_cycle' when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' when 'appointment_created' then 'appointment' when 'appointment_rescheduled' then 'appointment' when 'appointment_cancelled' then 'appointment' when 'payment_recorded' then 'ledger_entry' when 'refund_recorded' then 'ledger_entry' when 'ledger_adjustment_recorded' then 'ledger_entry' when 'charge_recorded' then 'ledger_entry' when 'conversation_created' then 'conversation' when 'conversation_assigned' then 'conversation' when 'conversation_closed' then 'conversation' when 'conversation_reopened' then 'conversation' when 'conversation_read' then 'conversation' when 'message_recorded' then 'conversation_message' when 'automation_rule_created' then 'automation_rule' when 'automation_rule_updated' then 'automation_rule' when 'automation_rule_enabled' then 'automation_rule' when 'automation_rule_disabled' then 'automation_rule' when 'automation_job_cancelled' then 'outbox_job' when 'automation_job_retried' then 'outbox_job' when 'google_calendar_connected' then 'google_calendar_connection' when 'google_calendar_disconnected' then 'google_calendar_connection' when 'google_calendar_sync_updated' then 'google_calendar_connection' when 'google_calendar_event_synced' then 'google_calendar_event_mapping' when 'google_calendar_reconciled' then 'google_calendar_connection' else '__invalid__' end
    and "audit_logs"."action" in ('procedure_started', 'procedure_completed', 'procedure_aborted', 'procedure_evidence_updated', 'consent_template_created', 'consent_template_version_published', 'consent_template_archived', 'cycle_consent_signed', 'medical_clearance_recorded', 'commercial_terms_confirmed', 'cycle_qualified', 'consultation_completed', 'consultation_result_recorded', 'cycle_created', 'cycle_stage_changed', 'total_face_package_created', 'total_face_package_completed', 'remover_cycle_created', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed', 'appointment_created', 'appointment_rescheduled', 'appointment_cancelled', 'payment_recorded', 'refund_recorded', 'ledger_adjustment_recorded', 'charge_recorded', 'conversation_created', 'conversation_assigned', 'conversation_closed', 'conversation_reopened', 'conversation_read', 'message_recorded', 'automation_rule_created', 'automation_rule_updated', 'automation_rule_enabled', 'automation_rule_disabled', 'automation_job_cancelled', 'automation_job_retried', 'google_calendar_connected', 'google_calendar_disconnected', 'google_calendar_sync_updated', 'google_calendar_event_synced', 'google_calendar_reconciled')));--> statement-breakpoint
INSERT INTO permissions (code, name) VALUES
  ('INTEGRATION_READ', 'Read studio integrations, connections and sync status'),
  ('INTEGRATION_MANAGE', 'Connect, disconnect and manage external studio integrations')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','ADMIN','SUPER_ADMIN','STUDIO_ADMIN') AND p.code IN ('INTEGRATION_READ','INTEGRATION_MANAGE')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MASTER') AND p.code IN ('INTEGRATION_READ')
ON CONFLICT (role_id, permission_id) DO NOTHING;