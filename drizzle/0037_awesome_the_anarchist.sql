CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_name" text NOT NULL,
	"instance_id" text NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
CREATE UNIQUE INDEX "worker_heartbeats_worker_instance_idx" ON "worker_heartbeats" USING btree ("worker_name","instance_id");--> statement-breakpoint
CREATE INDEX "worker_heartbeats_last_heartbeat_idx" ON "worker_heartbeats" USING btree ("last_heartbeat");--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'appointment.read', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report', 'cycles.list', 'cycles.timeline', 'consultations.read', 'commercial-terms.read', 'finance.summary', 'ledger.list', 'procedures.list', 'procedure.read', 'procedures.history', 'packages.list', 'package.read', 'packages.summary', 'conversations.list', 'conversation.read', 'conversations.messages', 'automations.list', 'automations.read', 'automation.rules.manage', 'google_calendar.connections.list', 'google_calendar.connection.read', 'google_calendar.events.list', 'ai.runs.list', 'ai.summary.read', 'ai.usage.read', 'handoffs.list', 'handoff.read', 'operations.read', 'operations.manage', 'operations.metrics', 'operations.retry'));--> statement-breakpoint
INSERT INTO permissions (code, name) VALUES
  ('OPERATIONS_READ', 'Read operational health and metrics'),
  ('OPERATIONS_MANAGE', 'Manage operational jobs, retries and health')
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','ADMIN','SUPER_ADMIN','STUDIO_ADMIN') AND p.code IN ('OPERATIONS_READ','OPERATIONS_MANAGE')
ON CONFLICT (role_id, permission_id) DO NOTHING;