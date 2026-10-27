ALTER TABLE "documents" ALTER COLUMN "object_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ALTER COLUMN "object_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "todo_id" uuid;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "todo_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_todo_idx" ON "documents" USING btree ("todo_id");--> statement-breakpoint
CREATE INDEX "links_todo_idx" ON "links" USING btree ("todo_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_one_owner" CHECK (("documents"."object_id" IS NULL) <> ("documents"."todo_id" IS NULL));--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_one_owner" CHECK (("links"."object_id" IS NULL) <> ("links"."todo_id" IS NULL));