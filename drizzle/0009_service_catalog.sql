CREATE TABLE "catalog_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_techniques" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_zones" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_definitions" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_code" text NOT NULL,
	"zone_code" text NOT NULL,
	"technique_code" text NOT NULL,
	"category" "service_category" NOT NULL,
	"procedure_type" "procedure_type" NOT NULL,
	"sessions_model" text NOT NULL,
	"price_mode" text NOT NULL,
	"price_cents" integer,
	"price_max_cents" integer,
	"duration_minutes" integer,
	CONSTRAINT "service_definitions_session_check" CHECK ("service_definitions"."sessions_model" in ('one','two','variable')
    and ("service_definitions"."category_code" != 'pmu' or "service_definitions"."sessions_model" = 'two') and ("service_definitions"."category_code" != 'remover' or "service_definitions"."sessions_model" = 'variable'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_contract_check";--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "price_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "duration_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "catalog_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "catalog_code" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "sessions_model" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_max_cents" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "preparation_template_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "post_care_template_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_category_code_catalog_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."catalog_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_zone_code_catalog_zones_code_fk" FOREIGN KEY ("zone_code") REFERENCES "public"."catalog_zones"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_technique_code_catalog_techniques_code_fk" FOREIGN KEY ("technique_code") REFERENCES "public"."catalog_techniques"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_definitions_session_key" ON "service_definitions" USING btree ("code","sessions_model");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_catalog_code_service_definitions_code_fk" FOREIGN KEY ("catalog_code") REFERENCES "public"."service_definitions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_definition_sessions_fk" FOREIGN KEY ("catalog_code","sessions_model") REFERENCES "public"."service_definitions"("code","sessions_model") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "services_id_studio_unique" ON "services" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_id_studio_unique" ON "whatsapp_templates" USING btree ("id","studio_id");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_preparation_studio_fk" FOREIGN KEY ("preparation_template_id","studio_id") REFERENCES "public"."whatsapp_templates"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_postcare_studio_fk" FOREIGN KEY ("post_care_template_id","studio_id") REFERENCES "public"."whatsapp_templates"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_replacement_studio_fk" FOREIGN KEY ("superseded_by_id","studio_id") REFERENCES "public"."services"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "services_studio_catalog_unique" ON "services" USING btree ("studio_id","catalog_code");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contract_check" CHECK ("audit_logs"."contract_version" = 0 or ("audit_logs"."contract_version" = 1
    and "audit_logs"."user_id" is not null and "audit_logs"."old_values" is not null and "audit_logs"."new_values" is not null
    and "audit_logs"."reason" is not null and length(trim("audit_logs"."reason")) > 0 and "audit_logs"."reason_source" is not null and "audit_logs"."reason_source" in ('user', 'command')
    and "audit_logs"."entity_type" = case "audit_logs"."action" when 'service_consolidated' then 'service' when 'job_recovered' then 'outbox_job' when 'client_created' then 'client' when 'client_updated' then 'client' when 'client_status_changed' then 'client' when 'client_archived' then 'client' when 'client_restored' then 'client' when 'client_master_assigned' then 'client' when 'medical_profile_updated' then 'client_medical_profile' when 'media_uploaded' then 'media' when 'media_archived' then 'media' when 'consent_uploaded' then 'consent' when 'consent_archived' then 'consent' when 'service_created' then 'service' when 'service_updated' then 'service' when 'service_archived' then 'service' when 'service_restored' then 'service' when 'master_created' then 'master' when 'master_updated' then 'master' when 'master_archived' then 'master' when 'master_restored' then 'master' when 'studio_settings_updated' then 'studio' when 'membership_changed' then 'studio_member' else '__invalid__' end
    and "audit_logs"."action" in ('service_consolidated', 'job_recovered', 'client_created', 'client_updated', 'client_status_changed', 'client_archived', 'client_restored', 'client_master_assigned', 'medical_profile_updated', 'media_uploaded', 'media_archived', 'consent_uploaded', 'consent_archived', 'service_created', 'service_updated', 'service_archived', 'service_restored', 'master_created', 'master_updated', 'master_archived', 'master_restored', 'studio_settings_updated', 'membership_changed')));--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_replacement_check" CHECK ("services"."superseded_by_id" is null or ("services"."superseded_by_id" != "services"."id" and "services"."is_active" = false and "services"."deleted_at" is not null));--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_catalog_contract_check" CHECK ("services"."catalog_version" = 0 or ("services"."catalog_version" = 1
          and "services"."catalog_code" is not null and "services"."sessions_model" is not null
          and "services"."buffer_before_minutes" = 0 and "services"."buffer_after_minutes" = 0
          and ("services"."duration_minutes" is null or "services"."duration_minutes" between 5 and 1440)
          and ("services"."is_active" = false or "services"."duration_minutes" is not null)
          and (("services"."price_mode" in ('fixed','estimate') and "services"."price_cents" is not null and "services"."price_max_cents" is null)
            or ("services"."price_mode" = 'range' and "services"."price_cents" is not null and "services"."price_max_cents" is not null and "services"."price_max_cents" >= "services"."price_cents")
            or ("services"."price_mode" = 'master_quote' and "services"."price_cents" is null and "services"."price_max_cents" is null))));
--> statement-breakpoint
INSERT INTO "catalog_categories" ("code","label") VALUES
('pmu','Перманентный макияж'),
('lamination','Ламинирование'),
('skin','Уход за кожей'),
('refresh','Refresh'),
('remover','Remover');

--> statement-breakpoint
INSERT INTO "catalog_zones" ("code","label") VALUES
('brows','Брови'),
('eyes','Глаза'),
('lips','Губы'),
('lashes','Ресницы'),
('skin','Кожа лица'),
('cycle_zone','Зона PMU определяется в цикле');

--> statement-breakpoint
INSERT INTO "catalog_techniques" ("code","label") VALUES
('hair_strokes','Волосковая техника'),
('shading','Растушёвка'),
('combo','Combo'),
('lashline','Межресничное заполнение'),
('eyeliner','Eyeliner'),
('sfumato','Eyeliner sfumato'),
('lip_pmu','PMU губ'),
('lamination','Ламинирование'),
('korean','Skin Experience Korean'),
('extended_skin','Extended Skin Experience / microneedling'),
('refresh','Refresh'),
('remover','Remover');

--> statement-breakpoint
INSERT INTO "service_definitions" ("code","name","category_code","zone_code","technique_code","category","procedure_type","sessions_model","price_mode","price_cents","price_max_cents","duration_minutes") VALUES
('brows-hair','Брови — волосковая техника','pmu','brows','hair_strokes','brows','brows','two','fixed',60000,NULL,120),
('brows-shading','Брови — растушёвка','pmu','brows','shading','brows','brows','two','estimate',50000,NULL,120),
('brows-combo','Брови — combo','pmu','brows','combo','brows','brows','two','fixed',55000,NULL,120),
('eyes-lashline','Глаза — межресничное заполнение','pmu','eyes','lashline','eyes','eyes','two','fixed',35000,NULL,120),
('eyes-eyeliner','Глаза — eyeliner','pmu','eyes','eyeliner','eyes','eyes','two','range',45000,50000,120),
('eyes-sfumato','Глаза — eyeliner sfumato','pmu','eyes','sfumato','eyes','eyes','two','fixed',55000,NULL,120),
('lips','Губы — PMU','pmu','lips','lip_pmu','lips','lips','two','range',50000,55000,120),
('lash-lamination','Laminazione ciglia','lamination','lashes','lamination','lamination','lamination','one','fixed',6000,NULL,NULL),
('brow-lamination','Laminazione sopracciglia','lamination','brows','lamination','lamination','lamination','one','fixed',6000,NULL,NULL),
('skin-korean','Skin Experience Korean','skin','skin','korean','skin','facial','one','fixed',12000,NULL,NULL),
('skin-extended','Extended Skin Experience / microneedling','skin','skin','extended_skin','skin','facial','one','fixed',15000,NULL,NULL),
('refresh','Refresh','refresh','cycle_zone','refresh','refresh','refresh','one','fixed',35000,NULL,60),
('remover','Remover','remover','cycle_zone','remover','remover','remover','variable','fixed',10000,NULL,60);
