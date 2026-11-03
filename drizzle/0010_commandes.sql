CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"code" text NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commands_name_uq" ON "commands" USING btree (lower("name"));--> statement-breakpoint
-- Commandes de départ
INSERT INTO "commands" ("name", "description", "code") VALUES
('date', 'Date du jour, ex. « 3 novembre 2026 »', E'return new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });'),
('heure', 'Heure actuelle, ex. « 14:05 »', E'return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });');
