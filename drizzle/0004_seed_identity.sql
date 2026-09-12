-- Collapse identical legacy grants before enforcing their natural key.
-- No entity references role_permissions.id; the oldest grant is retained.
DELETE FROM "role_permissions" AS duplicate
USING "role_permissions" AS original
WHERE duplicate.role_id = original.role_id
  AND duplicate.permission_id = original.permission_id
  AND (duplicate.created_at, duplicate.id) > (original.created_at, original.id);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "seed_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_permission_unique" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_studio_seed_key_unique" ON "services" USING btree ("studio_id","seed_key");