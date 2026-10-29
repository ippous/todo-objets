CREATE TYPE "public"."audit_entity" AS ENUM('objet', 'tache');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('interface', 'api', 'mcp', 'systeme');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "audit_source" NOT NULL,
	"client" text,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"entity_kind" "audit_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_label" text NOT NULL,
	"object_id" uuid,
	"action" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_kind","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_object_idx" ON "audit_log" USING btree ("object_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");