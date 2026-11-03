ALTER TABLE "photos" DROP CONSTRAINT "photos_one_owner";--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "draft_owner" uuid;--> statement-breakpoint
CREATE INDEX "photos_draft_idx" ON "photos" USING btree ("draft_owner");--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_one_owner" CHECK ((("photos"."object_id" IS NULL) <> ("photos"."todo_id" IS NULL)) OR ("photos"."object_id" IS NULL AND "photos"."todo_id" IS NULL AND "photos"."draft_owner" IS NOT NULL AND "photos"."inline"));