CREATE TABLE "medical_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_profile_revisions_revision_positive" CHECK ("medical_profile_revisions"."revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "medical_profile_revisions" ADD CONSTRAINT "medical_profile_revisions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_profile_revisions" ADD CONSTRAINT "medical_profile_revisions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_profile_revisions" ADD CONSTRAINT "medical_profile_revisions_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "medical_profile_revisions_client_revision_unique" ON "medical_profile_revisions" USING btree ("client_id","revision_number");--> statement-breakpoint
CREATE INDEX "medical_profile_revisions_studio_idx" ON "medical_profile_revisions" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "medical_profile_revisions_client_created_idx" ON "medical_profile_revisions" USING btree ("client_id","created_at");