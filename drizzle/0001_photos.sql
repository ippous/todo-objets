CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid,
	"todo_id" uuid,
	"pathname" text NOT NULL,
	"thumb_pathname" text NOT NULL,
	"width" integer,
	"height" integer,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_one_owner" CHECK (("photos"."object_id" IS NULL) <> ("photos"."todo_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_object_idx" ON "photos" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "photos_todo_idx" ON "photos" USING btree ("todo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_object_cover_uq" ON "photos" USING btree ("object_id") WHERE "photos"."is_cover" AND "photos"."object_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photos_todo_cover_uq" ON "photos" USING btree ("todo_id") WHERE "photos"."is_cover" AND "photos"."todo_id" IS NOT NULL;