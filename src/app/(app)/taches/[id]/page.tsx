import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteTodoAction, updateTodoAction } from "@/app/actions";
import { TodoForm } from "@/components/todo-form";
import { getDb } from "@/db";
import { objectOptions } from "@/lib/options";
import { getTodo, getUser, listObjects, listUsers } from "@/lib/repo";
import { returnPath } from "@/lib/return-to";
import { DeleteTodo } from "./delete-todo";

export const metadata: Metadata = { title: "Tâche" };

export default async function TachePage(props: PageProps<"/taches/[id]">) {
  const { id } = await props.params;
  const { retour } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const todo = await getTodo(db, id);
  if (!todo) notFound();
  const [objs, users, creator] = await Promise.all([
    listObjects(db),
    listUsers(db),
    todo.createdById ? getUser(db, todo.createdById) : undefined,
  ]);
  const back = returnPath(retour, `/objets/${todo.objectId}`);
  const created = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(todo.createdAt);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">{todo.title}</h1>
        <p className="text-sm text-muted">
          Créée le {created}
          {creator ? ` par ${creator.name}` : ""}
        </p>
      </div>
      <TodoForm
        action={updateTodoAction.bind(null, id)}
        values={todo}
        objects={objectOptions(objs)}
        users={users.filter((u) => u.active || u.id === todo.assigneeId).map((u) => ({ id: u.id, name: u.name }))}
        returnTo={back}
        submitLabel="Enregistrer"
      />
      <DeleteTodo action={deleteTodoAction.bind(null, id)} returnTo={back} />
    </div>
  );
}
