import type { Metadata } from "next";
import { createObjectAction } from "@/app/actions";
import { ObjectForm } from "@/components/object-form";
import { getDb } from "@/db";
import { getObject } from "@/lib/repo";

export const metadata: Metadata = { title: "Nouvel objet" };

export default async function NouvelObjetPage(props: PageProps<"/objets/nouveau">) {
  const { parent } = await props.searchParams;
  const parentId = typeof parent === "string" && /^[0-9a-f-]{36}$/i.test(parent) ? parent : null;
  const parentObj = parentId ? await getObject(getDb(), parentId) : undefined;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">
        {parentObj ? `Nouveau sous-objet de ${parentObj.name}` : "Nouvel objet racine"}
      </h1>
      <ObjectForm
        action={createObjectAction}
        parentId={parentObj?.id ?? null}
        submitLabel="Créer l'objet"
        cancelHref={parentObj ? `/objets/${parentObj.id}` : "/"}
      />
    </div>
  );
}
