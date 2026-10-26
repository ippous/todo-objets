CREATE TYPE "public"."category" AS ENUM('entretien', 'travaux', 'administratif');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('haute', 'moyenne', 'basse');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('aucune', 'mensuelle', 'saisonniere', 'annuelle');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'membre');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('a_faire', 'en_cours', 'fait');--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"type" text,
	"description" text,
	"location" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objects_not_own_parent" CHECK ("objects"."parent_id" IS NULL OR "objects"."parent_id" <> "objects"."id")
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "category" DEFAULT 'entretien' NOT NULL,
	"priority" "priority" DEFAULT 'moyenne' NOT NULL,
	"status" "status" DEFAULT 'a_faire' NOT NULL,
	"est_hours" numeric(8, 2),
	"actual_hours" numeric(8, 2),
	"est_value_eur" numeric(12, 2),
	"actual_value_eur" numeric(12, 2),
	"due_date" date,
	"recurrence" "recurrence" DEFAULT 'aucune' NOT NULL,
	"assignee_id" uuid,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"previous_occurrence_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" DEFAULT 'membre' NOT NULL,
	"weekly_hours_available" numeric(6, 2),
	"skills" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_previous_occurrence_fk" FOREIGN KEY ("previous_occurrence_id") REFERENCES "public"."todos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "objects_parent_idx" ON "objects" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "todos_object_idx" ON "todos" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "todos_status_idx" ON "todos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "todos_assignee_idx" ON "todos" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "todos_previous_occurrence_uq" ON "todos" USING btree ("previous_occurrence_id");