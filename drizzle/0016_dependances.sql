CREATE TABLE "todo_dependencies" (
	"todo_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todo_dependencies_todo_id_depends_on_id_pk" PRIMARY KEY("todo_id","depends_on_id"),
	CONSTRAINT "todo_dependencies_not_self" CHECK ("todo_dependencies"."todo_id" <> "todo_dependencies"."depends_on_id")
);
--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_depends_on_id_todos_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "todo_dependencies_depends_idx" ON "todo_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_start_before_due" CHECK ("todos"."start_date" IS NULL OR "todos"."due_date" IS NULL OR "todos"."start_date" <= "todos"."due_date");