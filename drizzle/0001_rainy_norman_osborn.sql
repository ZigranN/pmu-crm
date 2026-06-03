CREATE TYPE "public"."client_status" AS ENUM('new_lead', 'contacted', 'needs_consultation', 'consultation_booked', 'no_reply', 'appointment_booked', 'procedure_done', 'follow_up', 'second_session_needed', 'correction_needed', 'completed', 'returning_client', 'refresh_needed', 'lost');--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "client_status" SET DATA TYPE "public"."client_status" USING "client_status"::"public"."client_status";--> statement-breakpoint
CREATE INDEX "activity_events_studio_id_idx" ON "activity_events" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "activity_events_created_at_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "appointments_service_id_idx" ON "appointments" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "notifications_studio_id_idx" ON "notifications" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_studio_id_idx" ON "payments" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "tasks_studio_id_idx" ON "tasks" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");