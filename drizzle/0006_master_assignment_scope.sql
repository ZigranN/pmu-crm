CREATE TABLE "client_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"previous_master_id" uuid,
	"master_id" uuid,
	"changed_by_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "assigned_master_id" uuid;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_assignments_client_history_idx" ON "client_assignments" USING btree ("studio_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "masters_id_studio_unique" ON "masters" USING btree ("id","studio_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_assigned_master_studio_fk" FOREIGN KEY ("assigned_master_id","studio_id") REFERENCES "public"."masters"("id","studio_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_studio_assigned_master_idx" ON "clients" USING btree ("studio_id","assigned_master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "masters_studio_user_unique" ON "masters" USING btree ("studio_id","user_id");