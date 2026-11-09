CREATE TABLE "calendar_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"master_id" uuid,
	"type" text NOT NULL,
	"reason" text,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "calendar_exceptions_end_after_start_check" CHECK ("calendar_exceptions"."end_at" > "calendar_exceptions"."start_at")
);
--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_exceptions" ADD CONSTRAINT "calendar_exceptions_master_id_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_exceptions_studio_master_range_idx" ON "calendar_exceptions" USING btree ("studio_id","master_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "calendar_exceptions_studio_range_idx" ON "calendar_exceptions" USING btree ("studio_id","start_at","end_at");