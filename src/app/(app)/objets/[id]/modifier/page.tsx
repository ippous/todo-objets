import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteObjectAction, moveObjectAction, updateObjectAction } from "@/app/actions";
import { ObjectForm } from "@/components/object-form";
import { getDb } from "@/db";
import { objectOptions } from "@/lib/options";
import { listObjects, listTypes } from "@/lib/repo";
import { DeleteObject, MoveObject } from "./forms";

export const metadata: Metadata = { title: "Modifier l'objet" };

export default async function ModifierObjetPage(props: PageProps<"/objets/[id]/modifier">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [objs, types] = await Promise.all([listObjects(db), listTypes(db, "objet")]);
  const obj = objs.find((o) => o.id === id);
  if (!obj) notFound();

  return (
    <div className="grid gap-10">
      <section className="grid gap-4">
        <h1 className="text-2xl font-bold">Modifier {obj.name}</h1>
        <ObjectForm
          action={updateObjectAction.bind(null, id)}
          values={obj}
          submitLabel="Enregistrer les modifications"
          cancelHref={`/objets/${id}`}
          types={types}
        />
      </section>

      <section className="grid max-w-xl gap-3">
        <h2 className="text-lg font-bold">Déplacer</h2>
        <p className="text-muted">
          L&apos;objet part avec tous ses sous-objets et leurs tâches. Il ne peut pas être placé sous l&apos;un de ses propres
          descendants.
        </p>
        <MoveObject
          action={moveObjectAction.bind(null, id)}
          options={objectOptions(objs, id)}
          currentParentId={obj.parentId}
        />
      </section>

      <section className="grid max-w-xl gap-3">
        <h2 className="text-lg font-bold">Supprimer</h2>
        <p className="text-muted">Possible uniquement si l&apos;objet n&apos;a ni sous-objet ni tâche.</p>
        <DeleteObject action={deleteObjectAction.bind(null, id)} parentId={obj.parentId} name={obj.name} />
      </section>
    </div>
  );
}
