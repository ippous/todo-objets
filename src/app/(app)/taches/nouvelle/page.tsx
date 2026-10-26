import type { Metadata } from "next";
import Link from "next/link";
import { createTodoAction } from "@/app/actions";
import { TodoForm } from "@/components/todo-form";
import { getDb } from "@/db";
import { objectOptions } from "@/lib/options";
import { listObjects, listUsers } from "@/lib/repo";
import { returnPath } from "@/lib/return-to";

export const metadata: Metadata = { title: "Nouvelle tâche" };

export default async function NouvelleTachePage(props: PageProps<"/taches/nouvelle">) {
  const { objet, retour } = await props.searchParams;
  const db = getDb();
  const [objs, users] = await Promise.all([listObjects(db), listUsers(db)]);
  const objectId = typeof objet === "string" && objs.some((o) => o.id === objet) ? objet : undefined;

  if (objs.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-bold">Nouvelle tâche</h1>
        <p className="text-muted">Une tâche se rattache à un objet. Crée d&apos;abord un objet dans l&apos;arbre.</p>
        <Link href="/objets/nouveau" className="btn btn-primary w-fit">
          Créer un objet
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">Nouvelle tâche</h1>
      <TodoForm
        action={createTodoAction}
        objectId={objectId}
        objects={objectOptions(objs)}
        users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
        returnTo={returnPath(retour, objectId ? `/objets/${objectId}` : "/taches")}
        submitLabel="Créer la tâche"
      />
    </div>
  );
}
