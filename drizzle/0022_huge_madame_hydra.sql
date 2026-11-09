CREATE TABLE "cycle_medical_clearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"medical_revision_id" uuid NOT NULL,
	"decision_number" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"clinical_notes" text,
	"decided_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_medical_clearances_decision_check" CHECK ("cycle_medical_clearances"."decision" in ('CLEARED', 'CONSULTATION_REQUIRED', 'NOT_CLEARED')),
	CONSTRAINT "cycle_medical_clearances_decision_number_positive" CHECK ("cycle_medical_clearances"."decision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_medical_clearances" ADD CONSTRAINT "cycle_medical_clearances_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_medical_clearances" ADD CONSTRAINT "cycle_medical_clearances_cycle_id_treatment_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."treatment_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_medical_clearances" ADD CONSTRAINT "cycle_medical_clearances_medical_revision_id_medical_profile_revisions_id_fk" FOREIGN KEY ("medical_revision_id") REFERENCES "public"."medical_profile_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_medical_clearances" ADD CONSTRAINT "cycle_medical_clearances_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_medical_clearances_cycle_decision_unique" ON "cycle_medical_clearances" USING btree ("cycle_id","decision_number");--> statement-breakpoint
CREATE INDEX "cycle_medical_clearances_studio_idx" ON "cycle_medical_clearances" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "cycle_medical_clearances_medical_revision_idx" ON "cycle_medical_clearances" USING btree ("medical_revision_id");--> statement-breakpoint
CREATE INDEX "cycle_medical_clearances_cycle_medical_revision_idx" ON "cycle_medical_clearances" USING btree ("cycle_id","medical_revision_id");