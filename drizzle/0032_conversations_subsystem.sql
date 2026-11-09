CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"cycle_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"body" text NOT NULL,
	"sender_user_id" text,
	"provider_message_id" text,
	"provider_metadata" jsonb,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_direction_check" CHECK ("conversation_messages"."direction" in ('INBOUND', 'OUTBOUND')),
	CONSTRAINT "conversation_messages_channel_check" CHECK ("conversation_messages"."channel" in ('MANUAL', 'WHATSAPP', 'SMS', 'EMAIL')),
	CONSTRAINT "conversation_messages_body_check" CHECK (length(trim("conversation_messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_read_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"cycle_id" uuid,
	"assigned_user_id" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" in ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "procedure_sessions" DROP CONSTRAINT "procedure_sessions_status_check";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_identity" ON "conversations" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_studio_client_unique" ON "conversations" USING btree ("studio_id","client_id");--> statement-breakpoint
CREATE INDEX "conversations_studio_idx" ON "conversations" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "conversations_client_idx" ON "conversations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "conversations_assigned_user_idx" ON "conversations" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("studio_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_identity" ON "conversation_messages" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_studio_conversation_idx" ON "conversation_messages" USING btree ("studio_id","conversation_id","sent_at");--> statement-breakpoint
CREATE INDEX "conversation_messages_studio_client_idx" ON "conversation_messages" USING btree ("studio_id","client_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_provider_id_unique" ON "conversation_messages" USING btree ("studio_id","provider_message_id") WHERE "conversation_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_read_states_user_unique" ON "conversation_read_states" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_read_states_identity" ON "conversation_read_states" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "conversation_read_states_studio_user_idx" ON "conversation_read_states" USING btree ("studio_id","user_id");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_fk" FOREIGN KEY ("conversation_id","studio_id") REFERENCES "public"."conversations"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_conversation_fk" FOREIGN KEY ("conversation_id","studio_id") REFERENCES "public"."conversations"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read_states" ADD CONSTRAINT "conversation_read_states_message_fk" FOREIGN KEY ("last_read_message_id","studio_id") REFERENCES "public"."conversation_messages"("id","studio_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'appointment.read', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read', 'finance.summary', 'ledger.list', 'procedures.list', 'procedure.read', 'procedures.history', 'packages.list', 'package.read', 'packages.summary', 'conversations.list', 'conversation.read', 'conversations.messages'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'procedure_started' then 'procedure_session' when 'procedure_completed' then 'procedure_session' when 'procedure_aborted' then 'procedure_session' when 'procedure_evidence_updated' then 'procedure_session' when 'consent_template_created' then 'consent_template' when 'consent_template_version_published' then 'consent_template_version' when 'consent_template_archived' then 'consent_template' when 'cycle_consent_signed' then 'cycle_consent' when 'medical_clearance_recorded' then 'cycle_medical_clearance' when 'commercial_terms_confirmed' then 'cycle_commercial_terms' when 'cycle_qualified' then 'treatment_cycle' when 'consultation_completed' then 'treatment_cycle' when 'consultation_result_recorded' then 'treatment_cycle' when 'cycle_created' then 'treatment_cycle' when 'cycle_stage_changed' then 'treatment_cycle' when 'total_face_package_created' then 'treatment_package' when 'total_face_package_completed' then 'treatment_package' when 'remover_cycle_created' then 'treatment_cycle' when 'client_merged' then 'client' when 'client_duplicate_accepted' then 'client' when 'client_preferred_master_changed' then 'client' when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' when 'appointment_created' then 'appointment' when 'appointment_rescheduled' then 'appointment' when 'appointment_cancelled' then 'appointment' when 'payment_recorded' then 'ledger_entry' when 'refund_recorded' then 'ledger_entry' when 'ledger_adjustment_recorded' then 'ledger_entry' when 'charge_recorded' then 'ledger_entry' when 'conversation_created' then 'conversation' when 'conversation_assigned' then 'conversation' when 'conversation_closed' then 'conversation' when 'conversation_reopened' then 'conversation' when 'conversation_read' then 'conversation' when 'message_recorded' then 'conversation_message' else '__invalid__' end
    and "audit_logs"."action" in ('procedure_started', 'procedure_completed', 'procedure_aborted', 'procedure_evidence_updated', 'consent_template_created', 'consent_template_version_published', 'consent_template_archived', 'cycle_consent_signed', 'medical_clearance_recorded', 'commercial_terms_confirmed', 'cycle_qualified', 'consultation_completed', 'consultation_result_recorded', 'cycle_created', 'cycle_stage_changed', 'total_face_package_created', 'total_face_package_completed', 'remover_cycle_created', 'client_merged', 'client_duplicate_accepted', 'client_preferred_master_changed', 'master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed', 'appointment_created', 'appointment_rescheduled', 'appointment_cancelled', 'payment_recorded', 'refund_recorded', 'ledger_adjustment_recorded', 'charge_recorded', 'conversation_created', 'conversation_assigned', 'conversation_closed', 'conversation_reopened', 'conversation_read', 'message_recorded')));--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_sessions_status_check" CHECK ("procedure_sessions"."status" IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'));--> statement-breakpoint
INSERT INTO permissions (code, name) VALUES
  ('CONVERSATION_READ', 'Read client conversations and message history'),
  ('CONVERSATION_WRITE', 'Send and record conversation messages'),
  ('CONVERSATION_ASSIGN', 'Assign conversation staff owners')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','ADMIN','SUPER_ADMIN','STUDIO_ADMIN') AND p.code IN ('CONVERSATION_READ','CONVERSATION_WRITE','CONVERSATION_ASSIGN')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('MASTER') AND p.code IN ('CONVERSATION_READ','CONVERSATION_WRITE')
ON CONFLICT (role_id, permission_id) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION pmu_reject_message_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Conversation message evidence is immutable; updates and deletes are prohibited';
END;
$$;--> statement-breakpoint
CREATE TRIGGER conversation_messages_immutable BEFORE UPDATE OR DELETE ON conversation_messages FOR EACH ROW EXECUTE FUNCTION pmu_reject_message_change();