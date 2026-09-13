CREATE TABLE "cycle_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"result_id" uuid,
	"command_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_review_contract" CHECK ("cycle_reviews"."operation" in ('reassess','lost') and length(trim("cycle_reviews"."reason")) between 3 and 1000 and length(trim("cycle_reviews"."comment")) between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "follow_up_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_up_closure_reason" CHECK ("follow_up_closures"."reason" in ('cycle_left_branch','client_archived'))
);
--> statement-breakpoint
ALTER TABLE "cycle_reviews" ADD CONSTRAINT "cycle_reviews_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reviews" ADD CONSTRAINT "cycle_reviews_result_id_consultation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."consultation_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_reviews" ADD CONSTRAINT "cycle_review_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_closures" ADD CONSTRAINT "follow_up_closures_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_closures" ADD CONSTRAINT "follow_up_closures_result_id_consultation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."consultation_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_review_command_unique" ON "cycle_reviews" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_closure_result_unique" ON "follow_up_closures" USING btree ("result_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_cycle_history_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts r WHERE r.id=NEW.command_id AND r.studio_id=NEW.studio_id AND r.actor_id=NEW.actor_id AND (
   (r.command IN ('cycle.create.v1','cycle.transition.v1') AND r.result->>'id'=NEW.cycle_id::text AND (r.result->>'version')::integer=NEW.version)
   OR (r.command IN ('cycle.qualify.v1','consultation.complete.v1','consultation.result.v1','cycle.follow-up-reschedule.v1','cycle.review.v1') AND r.result->>'id'=NEW.cycle_id::text AND NEW.version>(r.result->>'fromVersion')::integer AND NEW.version<=(r.result->>'version')::integer)
   OR (r.command='consultation.result.v1' AND r.result->>'removerCycleId'=NEW.cycle_id::text AND NEW.version=1 AND NEW.from_stage IS NULL AND NEW.to_stage='new_lead')
 )) THEN RAISE EXCEPTION 'Cycle history requires matching command receipt'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE cycle_reviews ADD CONSTRAINT cycle_review_receipt_fk FOREIGN KEY (command_id) REFERENCES command_receipts(id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TRIGGER cycle_review_immutable BEFORE UPDATE OR DELETE ON cycle_reviews FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_immutable();
--> statement-breakpoint
CREATE TRIGGER follow_up_closure_immutable BEFORE UPDATE OR DELETE ON follow_up_closures FOR EACH ROW EXECUTE FUNCTION pmu_cycle_history_immutable();
--> statement-breakpoint
CREATE FUNCTION pmu_cycle_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM command_receipts c WHERE c.id=NEW.command_id AND c.studio_id=NEW.studio_id AND c.actor_id=NEW.actor_id AND c.command='cycle.review.v1' AND c.result->>'reviewId'=NEW.id::text AND c.result->>'id'=NEW.cycle_id::text)
 THEN RAISE EXCEPTION 'Cycle review requires matching command receipt'; END IF;
 IF NEW.result_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM consultation_results r JOIN consultations c ON c.id=r.consultation_id WHERE r.id=NEW.result_id AND r.studio_id=NEW.studio_id AND c.cycle_id=NEW.cycle_id)
 THEN RAISE EXCEPTION 'Cycle review must retain consultation result scope'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cycle_review_guard AFTER INSERT ON cycle_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_cycle_review_guard();
--> statement-breakpoint
CREATE FUNCTION pmu_follow_up_closure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM consultation_results r WHERE r.id=NEW.result_id AND r.studio_id=NEW.studio_id AND r.outcome IN ('client_thinking','temporarily_unavailable'))
 THEN RAISE EXCEPTION 'Closure requires a follow-up result in the same studio'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER follow_up_closure_guard AFTER INSERT ON follow_up_closures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_follow_up_closure_guard();
