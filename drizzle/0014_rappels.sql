CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reminder_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"todo_id" uuid NOT NULL,
	"offset_key" text NOT NULL,
	"due_key" text NOT NULL,
	"user_id" uuid,
	"outcome" text NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_schemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"offsets" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "due_time" time;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "reminder_scheme_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_deliveries_uq" ON "reminder_deliveries" USING btree ("todo_id","offset_key","due_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_schemes_name_uq" ON "reminder_schemes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_schemes_default_uq" ON "reminder_schemes" USING btree ("is_default") WHERE "reminder_schemes"."is_default";--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_reminder_scheme_id_reminder_schemes_id_fk" FOREIGN KEY ("reminder_scheme_id") REFERENCES "public"."reminder_schemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todos_due_idx" ON "todos" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_time_needs_date" CHECK ("todos"."due_time" IS NULL OR "todos"."due_date" IS NOT NULL);--> statement-breakpoint
INSERT INTO "reminder_schemes" ("name", "offsets", "is_default") VALUES
  ('Standard', '[{"n":10,"unit":"j"},{"n":5,"unit":"j"},{"n":2,"unit":"j"},{"n":1,"unit":"j"}]', true),
  ('Rendez-vous', '[{"n":10,"unit":"j"},{"n":1,"unit":"j"},{"n":3,"unit":"h"},{"n":10,"unit":"m"}]', false)
ON CONFLICT DO NOTHING;
