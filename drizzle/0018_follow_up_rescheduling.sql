CREATE TABLE "follow_up_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_revision_contract" CHECK ("follow_up_revisions"."sequence">0 and length(trim("follow_up_revisions"."reason")) between 3 and 1000 and length(trim("follow_up_revisions"."comment")) between 1 and 2000)
);
--> statement-breakpoint
DROP INDEX "tasks_follow_up_result_unique";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "follow_up_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "follow_up_revisions" ADD CONSTRAINT "follow_up_revisions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_revisions" ADD CONSTRAINT "follow_up_revisions_result_id_consultation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."consultation_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_revision_sequence" ON "follow_up_revisions" USING btree ("result_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_revision_command" ON "follow_up_revisions" USING btree ("command_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_follow_up_revision_id_follow_up_revisions_id_fk" FOREIGN KEY ("follow_up_revision_id") REFERENCES "public"."follow_up_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_follow_up_revision_unique" ON "tasks" USING btree ("follow_up_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_follow_up_result_unique" ON "tasks" USING btree ("follow_up_result_id") WHERE "tasks"."follow_up_revision_id" is null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_cycle_history_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts r WHERE r.id=NEW.command_id AND r.studio_id=NEW.studio_id AND r.actor_id=NEW.actor_id AND (
   (r.command IN ('cycle.create.v1','cycle.transition.v1') AND r.result->>'id'=NEW.cycle_id::text AND (r.result->>'version')::integer=NEW.version)
   OR (r.command IN ('cycle.qualify.v1','consultation.complete.v1','consultation.result.v1','cycle.follow-up-reschedule.v1') AND r.result->>'id'=NEW.cycle_id::text AND NEW.version>(r.result->>'fromVersion')::integer AND NEW.version<=(r.result->>'version')::integer)
   OR (r.command='consultation.result.v1' AND r.result->>'removerCycleId'=NEW.cycle_id::text AND NEW.version=1 AND NEW.from_stage IS NULL AND NEW.to_stage='new_lead')
 )) THEN RAISE EXCEPTION 'Cycle history requires matching command receipt'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE follow_up_revisions ADD CONSTRAINT follow_up_revision_receipt_fk FOREIGN KEY (command_id) REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TRIGGER follow_up_revision_immutable BEFORE UPDATE OR DELETE ON follow_up_revisions FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_immutable();
--> statement-breakpoint
CREATE FUNCTION pmu_follow_up_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM consultation_results r JOIN consultations s ON s.id=r.consultation_id JOIN command_receipts c ON c.id=NEW.command_id
   WHERE r.id=NEW.result_id AND r.studio_id=NEW.studio_id AND r.outcome IN ('client_thinking','temporarily_unavailable')
    AND c.command='cycle.follow-up-reschedule.v1' AND c.studio_id=NEW.studio_id AND c.actor_id=NEW.actor_id
    AND c.result->>'revisionId'=NEW.id::text AND c.result->>'id'=s.cycle_id::text)
 THEN RAISE EXCEPTION 'Follow-up revision needs matching human command receipt and decision'; END IF;
 IF NEW.sequence>1 AND NOT EXISTS (SELECT 1 FROM follow_up_revisions p WHERE p.result_id=NEW.result_id AND p.sequence=NEW.sequence-1)
 THEN RAISE EXCEPTION 'Follow-up revision sequence must be contiguous'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER follow_up_revision_guard AFTER INSERT ON follow_up_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_follow_up_revision_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_follow_up_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_now tasks;
BEGIN
 IF TG_OP='UPDATE' AND OLD.follow_up_result_id IS NOT NULL AND (
   NEW.follow_up_result_id IS DISTINCT FROM OLD.follow_up_result_id OR NEW.follow_up_revision_id IS DISTINCT FROM OLD.follow_up_revision_id)
 THEN RAISE EXCEPTION 'Follow-up source is immutable'; END IF;
 SELECT * INTO row_now FROM tasks WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF row_now.follow_up_revision_id IS NOT NULL AND row_now.follow_up_result_id IS NULL
 THEN RAISE EXCEPTION 'Follow-up revision requires a result'; END IF;
 IF row_now.follow_up_result_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM consultation_results r JOIN consultations s ON s.id=r.consultation_id JOIN treatment_cycles c ON c.id=s.cycle_id
   LEFT JOIN follow_up_revisions v ON v.id=row_now.follow_up_revision_id AND v.result_id=r.id AND v.studio_id=r.studio_id
   WHERE r.id=row_now.follow_up_result_id AND r.studio_id=row_now.studio_id AND s.studio_id=row_now.studio_id
     AND c.client_id=row_now.client_id AND s.appointment_id=row_now.appointment_id AND row_now.consultation_id IS NULL
     AND (row_now.follow_up_revision_id IS NULL OR v.id IS NOT NULL)
     AND ((r.outcome='client_thinking' AND row_now.due_at=(coalesce(v.due_at,r.follow_up_at) AT TIME ZONE 'UTC'))
       OR (r.outcome='temporarily_unavailable' AND row_now.due_at=(coalesce(v.due_at,r.reassessment_at) AT TIME ZONE 'UTC')))
 ) THEN RAISE EXCEPTION 'Follow-up task must retain decision, revision, client, visit and date'; END IF;
 RETURN NEW;
END;
$$;
