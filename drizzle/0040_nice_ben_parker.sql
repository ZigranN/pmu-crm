CREATE TABLE "instagram_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"instagram_account_id" text NOT NULL,
	"instagram_username" text,
	"instagram_name" text,
	"page_id" text,
	"page_name" text,
	"encrypted_access_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scope" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_connections_status_check" CHECK ("instagram_connections"."status" in ('connected', 'needs_reauth', 'error', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "instagram_connections" ADD CONSTRAINT "instagram_connections_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_connections" ADD CONSTRAINT "instagram_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_connections_identity" ON "instagram_connections" USING btree ("id","studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_connections_studio_account_unique" ON "instagram_connections" USING btree ("studio_id","instagram_account_id");--> statement-breakpoint
CREATE INDEX "instagram_connections_studio_idx" ON "instagram_connections" USING btree ("studio_id","status");