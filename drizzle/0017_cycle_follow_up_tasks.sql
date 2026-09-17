ALTER TABLE "tasks" ADD COLUMN "follow_up_result_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_up_result_id_consultation_results_id_fk" FOREIGN KEY ("follow_up_result_id") REFERENCES "public"."consultation_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_follow_up_result_unique" ON "tasks" USING btree ("follow_up_result_id");--> statement-breakpoint
CREATE FUNCTION pmu_follow_up_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_now tasks;
BEGIN
 IF TG_OP='UPDATE' AND OLD.follow_up_result_id IS NOT NULL AND NEW.follow_up_result_id IS DISTINCT FROM OLD.follow_up_result_id
 THEN RAISE EXCEPTION 'Follow-up source is immutable'; END IF;
 SELECT * INTO row_now FROM tasks WHERE id=NEW.id;
 IF FOUND AND row_now.follow_up_result_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM consultation_results r JOIN consultations s ON s.id=r.consultation_id JOIN treatment_cycles c ON c.id=s.cycle_id
   WHERE r.id=row_now.follow_up_result_id AND r.studio_id=row_now.studio_id AND s.studio_id=row_now.studio_id
     AND c.client_id=row_now.client_id AND s.appointment_id=row_now.appointment_id AND row_now.consultation_id IS NULL
     AND ((r.outcome='client_thinking' AND row_now.due_at=(r.follow_up_at AT TIME ZONE 'UTC'))
       OR (r.outcome='temporarily_unavailable' AND row_now.due_at=(r.reassessment_at AT TIME ZONE 'UTC')))
 ) THEN RAISE EXCEPTION 'Follow-up task must retain decision, client, visit and date'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER follow_up_task_guard AFTER INSERT OR UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_follow_up_task_guard();
--> statement-breakpoint
-- Enrol existing immutable decisions, without sending anything or changing CRM facts.
-- The worker rechecks live state before creating a task. UUID-only canonical JSON
-- is deliberately identical to payloadHash({resultId}) in idempotency.ts.
INSERT INTO outbox_jobs (studio_id,handler,event_key,payload,payload_hash,available_at)
SELECT r.studio_id,'cycle.follow-up-due.v1',r.id::text,jsonb_build_object('resultId',r.id::text),
 encode(sha256(convert_to('{"resultId":"'||r.id::text||'"}','UTF8')),'hex'),coalesce(r.follow_up_at,r.reassessment_at)
FROM consultation_results r
WHERE r.outcome IN ('client_thinking','temporarily_unavailable')
ON CONFLICT (studio_id,handler,event_key) DO NOTHING;
