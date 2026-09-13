CREATE TABLE "appointment_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"visit_kind" text NOT NULL,
	"service_snapshot" jsonb NOT NULL,
	"commercial_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_cycles_contract" CHECK ("appointment_cycles"."visit_kind" in ('consultation','session_1','session_2','control','correction','refresh','remover','single_session') and jsonb_typeof("appointment_cycles"."service_snapshot") = 'object' and ("appointment_cycles"."commercial_snapshot" is null or jsonb_typeof("appointment_cycles"."commercial_snapshot") = 'object'))
);
--> statement-breakpoint
CREATE TABLE "treatment_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"zone_code" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text DEFAULT 'new_lead' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"service_id" uuid,
	"assigned_master_id" uuid,
	"package_id" uuid,
	"origin_cycle_id" uuid,
	"offer_revision_id" uuid,
	"service_snapshot" jsonb,
	"commercial_snapshot" jsonb,
	"first_session_at" timestamp with time zone,
	"second_session_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_performed_pmu_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "treatment_cycles_contract" CHECK ("treatment_cycles"."kind" in ('pmu','refresh','remover','paid_correction','free_correction','non_pmu')
    and "treatment_cycles"."stage" in ('new_lead','qualification','consultation_needed','consultation_offered','consultation_scheduled','consultation_confirmed','consultation_completed','consultation_result_required','consultation_result','thinking','procedure_slot_selected','awaiting_acconto','procedure_confirmed','first_session_completed','second_session_scheduled','second_session_completed','control_scheduled','cycle_completed','refresh_offered','refresh_no_response','lost') and "treatment_cycles"."version" > 0
    and "treatment_cycles"."zone_code" in ('brows','eyes','lips','lashes','skin') and ("treatment_cycles"."kind" = 'non_pmu' or "treatment_cycles"."zone_code" in ('brows','eyes','lips'))
    and ("treatment_cycles"."origin_cycle_id" is null or "treatment_cycles"."origin_cycle_id" != "treatment_cycles"."id")
    and ("treatment_cycles"."kind" not in ('refresh','paid_correction','free_correction') or "treatment_cycles"."origin_cycle_id" is not null)
    and ("treatment_cycles"."package_id" is null or "treatment_cycles"."kind" = 'pmu')
    and ("treatment_cycles"."service_snapshot" is null or jsonb_typeof("treatment_cycles"."service_snapshot") = 'object')
    and ("treatment_cycles"."commercial_snapshot" is null or jsonb_typeof("treatment_cycles"."commercial_snapshot") = 'object')
    and (("treatment_cycles"."suspended_at" is null and "treatment_cycles"."suspension_reason" is null) or ("treatment_cycles"."suspended_at" is not null and "treatment_cycles"."suspension_reason" is not null and length(trim("treatment_cycles"."suspension_reason")) > 0))
    and ("treatment_cycles"."second_session_at" is null or ("treatment_cycles"."first_session_at" is not null and "treatment_cycles"."second_session_at" >= "treatment_cycles"."first_session_at")))
);
--> statement-breakpoint
CREATE TABLE "treatment_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text DEFAULT 'total_face' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"commercial_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "treatment_packages_contract" CHECK ("treatment_packages"."kind" = 'total_face' and "treatment_packages"."version" > 0 and ("treatment_packages"."commercial_snapshot" is null or jsonb_typeof("treatment_packages"."commercial_snapshot") = 'object'))
);
--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";
--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD COLUMN "cycle_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_cycles_identity" ON "appointment_cycles" USING btree ("appointment_id","cycle_id","studio_id","client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_cycles_pair_unique" ON "appointment_cycles" USING btree ("appointment_id","cycle_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_cycles_identity" ON "treatment_cycles" USING btree ("id","studio_id","client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_cycles_zone_identity" ON "treatment_cycles" USING btree ("id","studio_id","client_id","zone_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_cycles_package_zone_unique" ON "treatment_cycles" USING btree ("package_id","zone_code");
--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_packages_identity" ON "treatment_packages" USING btree ("id","studio_id","client_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_id_studio_client_unique" ON "appointments" USING btree ("id","studio_id","client_id");
--> statement-breakpoint
ALTER TABLE "appointment_cycles" ADD CONSTRAINT "appointment_cycles_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_cycles" ADD CONSTRAINT "appointment_cycles_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_cycles" ADD CONSTRAINT "appointment_cycles_appointment_fk" FOREIGN KEY ("appointment_id","studio_id","client_id") REFERENCES "public"."appointments"("id","studio_id","client_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "appointment_cycles" ADD CONSTRAINT "appointment_cycles_cycle_fk" FOREIGN KEY ("cycle_id","studio_id","client_id") REFERENCES "public"."treatment_cycles"("id","studio_id","client_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_zone_code_catalog_zones_code_fk" FOREIGN KEY ("zone_code") REFERENCES "public"."catalog_zones"("code") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_service_fk" FOREIGN KEY ("service_id","studio_id") REFERENCES "public"."services"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_master_fk" FOREIGN KEY ("assigned_master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_package_fk" FOREIGN KEY ("package_id","studio_id","client_id") REFERENCES "public"."treatment_packages"("id","studio_id","client_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_origin_fk" FOREIGN KEY ("origin_cycle_id","studio_id","client_id","zone_code") REFERENCES "public"."treatment_cycles"("id","studio_id","client_id","zone_code") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "treatment_cycles" ADD CONSTRAINT "treatment_cycles_offer_fk" FOREIGN KEY ("offer_revision_id","studio_id") REFERENCES "public"."offer_revisions"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_packages" ADD CONSTRAINT "treatment_packages_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_packages" ADD CONSTRAINT "treatment_packages_client_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "treatment_cycles_client_idx" ON "treatment_cycles" USING btree ("studio_id","client_id");
--> statement-breakpoint
CREATE INDEX "treatment_cycles_master_idx" ON "treatment_cycles" USING btree ("studio_id","assigned_master_id");
--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_cycle_client_fk" FOREIGN KEY ("cycle_id","studio_id","client_id") REFERENCES "public"."treatment_cycles"("id","studio_id","client_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_appointment_cycle_fk" FOREIGN KEY ("appointment_id","cycle_id","studio_id","client_id") REFERENCES "public"."appointment_cycles"("appointment_id","cycle_id","studio_id","client_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE INDEX "procedure_sessions_cycle_idx" ON "procedure_sessions" USING btree ("studio_id","cycle_id");
--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read', 'clients.duplicates', 'clients.merge.preview', 'clients.merge.history', 'cycles.legacy.report'));
--> statement-breakpoint
CREATE FUNCTION pmu_lock_cycle_studio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM studios WHERE id = NEW.studio_id FOR UPDATE;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cycle_studio_lock BEFORE INSERT OR UPDATE ON treatment_cycles FOR EACH ROW EXECUTE FUNCTION pmu_lock_cycle_studio();
--> statement-breakpoint
CREATE FUNCTION pmu_validate_cycle_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_cycle treatment_cycles; definition service_definitions; linked_client uuid;
BEGIN
  SELECT * INTO current_cycle FROM treatment_cycles WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, origin_cycle_id, ARRAY[id] AS path, false AS loop FROM treatment_cycles WHERE id = current_cycle.id
      UNION ALL SELECT p.id,p.origin_cycle_id,a.path || p.id,p.id = ANY(a.path)
      FROM ancestors a JOIN treatment_cycles p ON p.id = a.origin_cycle_id WHERE NOT a.loop
    ) SELECT 1 FROM ancestors WHERE loop
  ) THEN RAISE EXCEPTION 'Cycle origin cannot form a loop'; END IF;
  IF EXISTS (SELECT 1 FROM procedure_sessions WHERE cycle_id = current_cycle.id AND procedure_area::text != current_cycle.zone_code) THEN RAISE EXCEPTION 'Cycle zone conflicts with linked procedure'; END IF;
  IF current_cycle.kind IN ('remover','non_pmu') AND EXISTS (SELECT 1 FROM treatment_cycles WHERE origin_cycle_id = current_cycle.id) THEN RAISE EXCEPTION 'Origin must remain a PMU treatment cycle'; END IF;
  IF current_cycle.origin_cycle_id IS NOT NULL AND EXISTS (SELECT 1 FROM treatment_cycles WHERE id = current_cycle.origin_cycle_id AND kind IN ('remover','non_pmu')) THEN
    RAISE EXCEPTION 'Origin must be a PMU treatment cycle';
  END IF;
  IF current_cycle.offer_revision_id IS NOT NULL THEN
    SELECT o.client_id INTO linked_client FROM offer_revisions r JOIN custom_offers o ON o.id = r.offer_id AND o.studio_id = r.studio_id WHERE r.id = current_cycle.offer_revision_id;
    IF linked_client IS DISTINCT FROM current_cycle.client_id THEN RAISE EXCEPTION 'Offer belongs to another client'; END IF;
  END IF;
  IF current_cycle.service_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id OR NEW.zone_code IS DISTINCT FROM OLD.zone_code OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    SELECT d.* INTO definition FROM services s JOIN service_definitions d ON d.code = s.catalog_code WHERE s.id = current_cycle.service_id AND s.studio_id = current_cycle.studio_id;
    IF NOT FOUND OR (definition.zone_code != current_cycle.zone_code AND definition.zone_code != 'cycle_zone') THEN RAISE EXCEPTION 'Cycle requires a compatible catalog service'; END IF;
    IF (current_cycle.kind = 'pmu' AND definition.category_code != 'pmu') OR (current_cycle.kind = 'remover' AND definition.category_code != 'remover')
      OR (current_cycle.kind = 'refresh' AND definition.category_code != 'refresh') OR (current_cycle.kind = 'non_pmu' AND definition.category_code NOT IN ('skin','lamination'))
    THEN RAISE EXCEPTION 'Service and cycle kind conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cycle_links_guard AFTER INSERT OR UPDATE ON treatment_cycles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_validate_cycle_links();
--> statement-breakpoint
CREATE FUNCTION pmu_validate_procedure_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_now procedure_sessions;
BEGIN
 SELECT * INTO row_now FROM procedure_sessions WHERE id = NEW.id;
 IF FOUND AND row_now.cycle_id IS NOT NULL AND EXISTS (SELECT 1 FROM treatment_cycles c WHERE c.id = row_now.cycle_id AND c.zone_code != row_now.procedure_area::text) THEN
   RAISE EXCEPTION 'Procedure and cycle zone conflict';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER procedure_cycle_zone_guard AFTER INSERT OR UPDATE ON procedure_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_validate_procedure_cycle();
