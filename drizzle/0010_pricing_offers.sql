CREATE TABLE "custom_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_price_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"price_cents" integer,
	"reason" text NOT NULL,
	"approved_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "master_price_revision_check" CHECK ("master_price_revisions"."revision" > 0 and ("master_price_revisions"."price_cents" is null or "master_price_revisions"."price_cents" >= 0) and length(trim("master_price_revisions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "offer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"master_id" uuid,
	"zone_code" text NOT NULL,
	"service_name" text NOT NULL,
	"master_name" text,
	"standard_cents" integer NOT NULL,
	"price_snapshot" jsonb NOT NULL,
	CONSTRAINT "offer_item_amount_check" CHECK ("offer_items"."standard_cents" >= 0 and "offer_items"."zone_code" in ('brows','eyes','lips'))
);
--> statement-breakpoint
CREATE TABLE "offer_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"standard_total_cents" integer NOT NULL,
	"agreed_total_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"reason" text NOT NULL,
	"approved_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offer_revision_totals_check" CHECK ("offer_revisions"."revision" > 0 and "offer_revisions"."standard_total_cents" >= 0 and "offer_revisions"."agreed_total_cents" >= 0 and "offer_revisions"."discount_cents" = greatest(0, "offer_revisions"."standard_total_cents" - "offer_revisions"."agreed_total_cents") and "offer_revisions"."currency" = 'EUR' and length(trim("offer_revisions"."reason")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_offers_id_studio_unique" ON "custom_offers" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "master_price_revision_unique" ON "master_price_revisions" USING btree ("studio_id","service_id","master_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_items_zone_unique" ON "offer_items" USING btree ("revision_id","zone_code");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_revisions_id_studio_unique" ON "offer_revisions" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_revision_unique" ON "offer_revisions" USING btree ("offer_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_id_studio_unique" ON "clients" USING btree ("id","studio_id");--> statement-breakpoint
ALTER TABLE "access_logs" DROP CONSTRAINT "access_logs_operation_check";--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_offers" ADD CONSTRAINT "custom_offers_client_id_studio_id_clients_id_studio_id_fk" FOREIGN KEY ("client_id","studio_id") REFERENCES "public"."clients"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_price_revisions" ADD CONSTRAINT "master_price_revisions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_price_revisions" ADD CONSTRAINT "master_price_revisions_service_id_studio_id_services_id_studio_id_fk" FOREIGN KEY ("service_id","studio_id") REFERENCES "public"."services"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_price_revisions" ADD CONSTRAINT "master_price_revisions_master_id_studio_id_masters_id_studio_id_fk" FOREIGN KEY ("master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_zone_code_catalog_zones_code_fk" FOREIGN KEY ("zone_code") REFERENCES "public"."catalog_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_revision_id_studio_id_offer_revisions_id_studio_id_fk" FOREIGN KEY ("revision_id","studio_id") REFERENCES "public"."offer_revisions"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_service_id_studio_id_services_id_studio_id_fk" FOREIGN KEY ("service_id","studio_id") REFERENCES "public"."services"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_master_id_studio_id_masters_id_studio_id_fk" FOREIGN KEY ("master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_offer_id_studio_id_custom_offers_id_studio_id_fk" FOREIGN KEY ("offer_id","studio_id") REFERENCES "public"."custom_offers"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_operation_check" CHECK ("access_logs"."operation" in ('clients.list', 'client.read', 'clients.search', 'global.search', 'medical.read', 'activity.read', 'media.list', 'media.read', 'consents.list', 'masters.list', 'master.read', 'appointments.list', 'payments.list', 'transactions.list', 'audit.list', 'access.list', 'jobs.list', 'offers.read', 'pricing.read'));--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'master_price_changed' then 'master_price_revision' when 'offer_created' then 'offer_revision' when 'offer_revised' then 'offer_revision' when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('master_price_changed', 'offer_created', 'offer_revised', 'service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));
--> statement-breakpoint
INSERT INTO permissions (code, name) VALUES ('OFFER_READ', 'Read client custom offers'), ('OFFER_MANAGE', 'Approve custom offer revisions') ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('OWNER','ADMIN','SUPER_ADMIN','STUDIO_ADMIN','ASSISTANT') AND p.code IN ('OFFER_READ','OFFER_MANAGE')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION pmu_reject_pricing_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Studio deletion is reserved for explicit retention/test teardown; no app command exposes it.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM studios WHERE id = OLD.studio_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Pricing history is immutable; create a new revision';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER master_price_history_immutable BEFORE UPDATE OR DELETE ON master_price_revisions FOR EACH ROW EXECUTE FUNCTION pmu_reject_pricing_history_change();
--> statement-breakpoint
CREATE TRIGGER offer_identity_immutable BEFORE UPDATE OR DELETE ON custom_offers FOR EACH ROW EXECUTE FUNCTION pmu_reject_pricing_history_change();
--> statement-breakpoint
CREATE TRIGGER offer_revision_immutable BEFORE UPDATE OR DELETE ON offer_revisions FOR EACH ROW EXECUTE FUNCTION pmu_reject_pricing_history_change();
--> statement-breakpoint
CREATE TRIGGER offer_item_immutable BEFORE UPDATE OR DELETE ON offer_items FOR EACH ROW EXECUTE FUNCTION pmu_reject_pricing_history_change();
--> statement-breakpoint
CREATE FUNCTION pmu_offer_item_creation_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM offer_revisions r WHERE r.id = NEW.revision_id AND r.studio_id = NEW.studio_id AND r.xmin = pg_current_xact_id()::text::xid) THEN
    RAISE EXCEPTION 'Offer items must be inserted with their new revision';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER offer_items_creation_only BEFORE INSERT ON offer_items FOR EACH ROW EXECUTE FUNCTION pmu_offer_item_creation_only();
--> statement-breakpoint
CREATE FUNCTION pmu_check_offer_revision_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item_count integer; total bigint;
BEGIN
  SELECT count(*), sum(standard_cents) INTO item_count, total FROM offer_items WHERE revision_id = NEW.id;
  IF item_count NOT BETWEEN 2 AND 3 OR total IS DISTINCT FROM NEW.standard_total_cents::bigint THEN
    RAISE EXCEPTION 'Offer revision requires 2-3 zones and matching standard total';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER offer_revision_total AFTER INSERT ON offer_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pmu_check_offer_revision_total();
