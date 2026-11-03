CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "type_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "task_types_name_uq" ON "task_types" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_type_id_task_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."task_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todos_type_idx" ON "todos" USING btree ("type_id");--> statement-breakpoint
-- Les trois catégories deviennent des types de tâche ; chaque tâche garde la sienne
INSERT INTO "task_types" ("name", "icon") VALUES ('Entretien', 'wrench'), ('Travaux', 'hammer'), ('Administratif', 'file-text');--> statement-breakpoint
UPDATE "todos" SET "type_id" = tt."id" FROM "task_types" tt WHERE lower(tt."name") = "todos"."category"::text;--> statement-breakpoint
ALTER TABLE "todos" DROP COLUMN "category";--> statement-breakpoint
DROP TYPE "public"."category";