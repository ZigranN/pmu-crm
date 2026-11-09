CREATE UNIQUE INDEX "media_studio_identity" ON "media" USING btree ("id","studio_id");--> statement-breakpoint
CREATE TABLE "cycle_consent_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"zone_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"media_id" uuid,
	"signed_pdf_sha256" text,
	"signature_method" text,
	"signature_payload" jsonb,
	"signatory_name" text,
	"signatory_role" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"finalized_by_id" text,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "cycle_consents_status_check" CHECK ("cycle_consents"."status" in ('DRAFT', 'SIGNED')),
	CONSTRAINT "cycle_consents_signature_method_check" CHECK ("cycle_consents"."signature_method" is null or "cycle_consents"."signature_method" in ('in_person_stylus', 'draw_on_screen', 'remote_link', 'biometric')),
	CONSTRAINT "cycle_consents_signatory_role_check" CHECK ("cycle_consents"."signatory_role" is null or "cycle_consents"."signatory_role" in ('client', 'guardian', 'representative')),
	CONSTRAINT "cycle_consents_lifecycle_check" CHECK ((
      "cycle_consents"."status" = 'DRAFT'
      and "cycle_consents"."signed_at" is null
      and "cycle_consents"."media_id" is null
      and "cycle_consents"."signed_pdf_sha256" is null
      and "cycle_consents"."signature_method" is null
      and "cycle_consents"."signature_payload" is null
      and "cycle_consents"."finalized_by_id" is null
      and "cycle_consents"."finalized_at" is null
    ) or (
      "cycle_consents"."status" = 'SIGNED'
      and "cycle_consents"."signed_at" is not null
      and "cycle_consents"."media_id" is not null
      and "cycle_consents"."signed_pdf_sha256" is not null
      and "cycle_consents"."signed_pdf_sha256" ~ '^[0-9a-f]{64}$'
      and "cycle_consents"."signature_method" is not null
      and "cycle_consents"."signature_payload" is not null
      and jsonb_typeof("cycle_consents"."signature_payload") = 'object'
      and "cycle_consents"."signatory_name" is not null
      and length(trim("cycle_consents"."signatory_name")) > 0
      and "cycle_consents"."signatory_role" is not null
      and "cycle_consents"."finalized_by_id" is not null
      and "cycle_consents"."finalized_at" is not null
      and "cycle_consents"."finalized_at" >= "cycle_consents"."signed_at"
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_consent_zones_consent_zone_unique" ON "cycle_consent_zones" USING btree ("consent_id","zone_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_consent_zones_identity" ON "cycle_consent_zones" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "cycle_consent_zones_studio_consent_idx" ON "cycle_consent_zones" USING btree ("studio_id","consent_id");--> statement-breakpoint
CREATE INDEX "cycle_consent_zones_zone_idx" ON "cycle_consent_zones" USING btree ("zone_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_consents_identity" ON "cycle_consents" USING btree ("id","studio_id");--> statement-breakpoint
CREATE INDEX "cycle_consents_studio_idx" ON "cycle_consents" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "cycle_consents_cycle_idx" ON "cycle_consents" USING btree ("studio_id","cycle_id");--> statement-breakpoint
CREATE INDEX "cycle_consents_client_idx" ON "cycle_consents" USING btree ("studio_id","client_id");--> statement-breakpoint
CREATE INDEX "cycle_consents_template_version_idx" ON "cycle_consents" USING btree ("template_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_consents_media_unique" ON "cycle_consents" USING btree ("media_id") WHERE "cycle_consents"."media_id" is not null;--> statement-breakpoint
ALTER TABLE "cycle_consent_zones" ADD CONSTRAINT "cycle_consent_zones_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consent_zones" ADD CONSTRAINT "cycle_consent_zones_zone_code_catalog_zones_code_fk" FOREIGN KEY ("zone_code") REFERENCES "public"."catalog_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consent_zones" ADD CONSTRAINT "cycle_consent_zones_consent_fk" FOREIGN KEY ("consent_id","studio_id") REFERENCES "public"."cycle_consents"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_finalized_by_id_user_id_fk" FOREIGN KEY ("finalized_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_cycle_fk" FOREIGN KEY ("cycle_id","studio_id") REFERENCES "public"."treatment_cycles"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_template_fk" FOREIGN KEY ("template_version_id","studio_id") REFERENCES "public"."consent_template_versions"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_consents" ADD CONSTRAINT "cycle_consents_media_fk" FOREIGN KEY ("media_id","studio_id") REFERENCES "public"."media"("id","studio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_guard_cycle_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 1. INSERT Guard: Direct insertion of SIGNED consent is forbidden
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Cycle consent must be created as DRAFT';
    END IF;
    RETURN NEW;
  END IF;

  -- 2. DELETE Guard: Signed evidence cannot be deleted
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'SIGNED' THEN
      RAISE EXCEPTION 'Signed cycle consents cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  -- 3. UPDATE Guard: Enforce immutability and finalization invariants
  IF TG_OP = 'UPDATE' THEN
    -- Signed consents are permanently immutable; cannot be edited or reverted to DRAFT
    IF OLD.status = 'SIGNED' THEN
      RAISE EXCEPTION 'Signed cycle consents are immutable';
    END IF;

    -- Prevent changing immutable resource identity
    IF NEW.studio_id <> OLD.studio_id OR NEW.cycle_id <> OLD.cycle_id OR NEW.client_id <> OLD.client_id THEN
      RAISE EXCEPTION 'Cannot reassign studio, cycle, or client identity of cycle consent';
    END IF;

    -- Finalization transition: DRAFT -> SIGNED
    IF OLD.status = 'DRAFT' AND NEW.status = 'SIGNED' THEN
      -- Verify template version existence, studio tenant match, and publication state
      IF NOT EXISTS (
        SELECT 1 FROM consent_template_versions
        WHERE id = NEW.template_version_id
          AND studio_id = NEW.studio_id
          AND published_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Cannot seal consent against an unpublished or non-existent template version';
      END IF;

      -- Verify at least one covered zone exists for this consent
      IF NOT EXISTS (
        SELECT 1 FROM cycle_consent_zones
        WHERE consent_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'Cannot seal consent without at least one covered zone';
      END IF;

      -- Verify covered zones include the anchored TreatmentCycle's actual zoneCode
      IF NOT EXISTS (
        SELECT 1 FROM treatment_cycles tc
        JOIN cycle_consent_zones ccz ON ccz.consent_id = NEW.id AND ccz.zone_code = tc.zone_code
        WHERE tc.id = NEW.cycle_id AND tc.studio_id = NEW.studio_id
      ) THEN
        RAISE EXCEPTION 'Covered zones must include the anchored cycle zone code';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cycle_consent_guard
BEFORE INSERT OR UPDATE OR DELETE ON cycle_consents
FOR EACH ROW EXECUTE FUNCTION pmu_guard_cycle_consent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pmu_guard_cycle_consent_zone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM cycle_consents WHERE id = OLD.consent_id FOR SHARE;
    IF v_status IS NULL OR v_status = 'SIGNED' THEN
      RAISE EXCEPTION 'Cannot delete zones from a signed consent';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM cycle_consents WHERE id = NEW.consent_id FOR SHARE;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'Referenced consent does not exist';
    END IF;
    IF v_status = 'SIGNED' THEN
      RAISE EXCEPTION 'Cannot add zones to an already signed consent';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.consent_id <> OLD.consent_id THEN
      RAISE EXCEPTION 'Reassigning consent_id is forbidden';
    END IF;
    IF NEW.studio_id <> OLD.studio_id THEN
      RAISE EXCEPTION 'Reassigning studio_id is forbidden';
    END IF;
    SELECT status INTO v_status FROM cycle_consents WHERE id = OLD.consent_id FOR SHARE;
    IF v_status IS NULL OR v_status = 'SIGNED' THEN
      RAISE EXCEPTION 'Cannot modify zones of a signed consent';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cycle_consent_zone_guard
BEFORE INSERT OR UPDATE OR DELETE ON cycle_consent_zones
FOR EACH ROW EXECUTE FUNCTION pmu_guard_cycle_consent_zone();