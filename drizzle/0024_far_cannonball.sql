CREATE TABLE "consent_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "consent_template_versions_version_positive" CHECK ("consent_template_versions"."version_number" > 0),
	CONSTRAINT "consent_template_versions_content_check" CHECK (length(trim("consent_template_versions"."title")) > 0 and length(trim("consent_template_versions"."body")) > 0 and length(trim("consent_template_versions"."content_hash")) = 64)
);
--> statement-breakpoint
CREATE TABLE "consent_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "consent_templates_contract" CHECK (length(trim("consent_templates"."code")) > 0 and length(trim("consent_templates"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "consent_templates_studio_code_unique" ON "consent_templates" USING btree ("studio_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_templates_identity" ON "consent_templates" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "consent_templates_studio_idx" ON "consent_templates" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_template_versions_template_version_unique" ON "consent_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_template_versions_identity" ON "consent_template_versions" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "consent_template_versions_studio_idx" ON "consent_template_versions" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "consent_template_versions_template_idx" ON "consent_template_versions" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "consent_template_versions" ADD CONSTRAINT "consent_template_versions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_template_versions" ADD CONSTRAINT "consent_template_versions_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_template_versions" ADD CONSTRAINT "consent_template_versions_template_fk" FOREIGN KEY ("template_id","studio_id") REFERENCES "public"."consent_templates"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_templates" ADD CONSTRAINT "consent_templates_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_templates" ADD CONSTRAINT "consent_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_guard_consent_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN
      RETURN OLD;
    END IF;
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Published consent template versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Published consent template versions are immutable';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_template_version_guard
BEFORE UPDATE OR DELETE ON consent_template_versions
FOR EACH ROW EXECUTE FUNCTION pmu_guard_consent_template_version();