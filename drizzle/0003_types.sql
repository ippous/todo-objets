-- Types d'objets et de documents gérables (remplace le type d'objet en texte libre)
CREATE TABLE "object_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_types_name_uq" ON "object_types" USING btree (lower("name"));
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_name_uq" ON "document_types" USING btree (lower("name"));
--> statement-breakpoint
-- Types d'objets de départ, puis ceux déjà saisis
INSERT INTO "object_types" ("name")
SELECT v FROM (VALUES ('propriété'), ('bâtiment'), ('pièce'), ('terrain'), ('véhicule'), ('machine'), ('équipement'), ('projet')) AS d(v)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "object_types" ("name")
SELECT DISTINCT ON (lower(btrim("type"))) btrim("type") FROM "objects"
WHERE "type" IS NOT NULL AND btrim("type") <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN "type_id" uuid;
--> statement-breakpoint
UPDATE "objects" o SET "type_id" = t."id"
FROM "object_types" t
WHERE o."type" IS NOT NULL AND lower(btrim(o."type")) = lower(t."name");
--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_type_id_object_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."object_types"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "objects" DROP COLUMN "type";
--> statement-breakpoint
-- Types de documents de départ ; les documents existants passent en « Autre »
INSERT INTO "document_types" ("name")
SELECT v FROM (VALUES ('Facture'), ('Garantie'), ('Mode d''emploi'), ('Guide de démarrage'), ('Devis'), ('Contrat'), ('Plan'), ('Certificat'), ('Photo'), ('Autre')) AS d(v)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type_id" uuid;
--> statement-breakpoint
UPDATE "documents" SET "type_id" = (SELECT "id" FROM "document_types" WHERE lower("name") = 'autre');
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_document_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."document_types"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "objects_type_idx" ON "objects" USING btree ("type_id");
--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type_id");
