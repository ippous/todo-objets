// Enchaînement des tâches (fin → début) : une tâche « attend » d'autres tâches.
// Elle est « bloquée » tant que l'une d'elles n'est pas faite. Les boucles sont refusées.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { objects, todoDependencies, todos, type Todo } from "@/db/schema";
import { logAction, todoTarget, type Actor } from "./audit";
import { DomainError } from "./repo";

export const DEPENDENCIES_MAX = 30;

export type LinkedTodo = Pick<Todo, "id" | "title" | "status" | "startDate" | "dueDate" | "objectId"> & { objectName: string };

const linkedFields = {
  id: todos.id,
  title: todos.title,
  status: todos.status,
  startDate: todos.startDate,
  dueDate: todos.dueDate,
  objectId: todos.objectId,
  objectName: objects.name,
};

/** Tâches attendues par `todoId` (prédécesseurs) et tâches qui l'attendent (successeurs). */
export async function getDependencies(db: Db, todoId: string): Promise<{ attend: LinkedTodo[]; debloque: LinkedTodo[] }> {
  const [attend, debloque] = await Promise.all([
    db
      .select(linkedFields)
      .from(todoDependencies)
      .innerJoin(todos, eq(todos.id, todoDependencies.dependsOnId))
      .innerJoin(objects, eq(objects.id, todos.objectId))
      .where(eq(todoDependencies.todoId, todoId))
      .orderBy(sql`${todos.dueDate} ASC NULLS LAST`, asc(todos.title)),
    db
      .select(linkedFields)
      .from(todoDependencies)
      .innerJoin(todos, eq(todos.id, todoDependencies.todoId))
      .innerJoin(objects, eq(objects.id, todos.objectId))
      .where(eq(todoDependencies.dependsOnId, todoId))
      .orderBy(sql`${todos.dueDate} ASC NULLS LAST`, asc(todos.title)),
  ]);
  return { attend, debloque };
}

/** Une tâche est bloquée tant qu'une tâche qu'elle attend n'est pas faite. */
export const isBlocked = (attend: Pick<LinkedTodo, "status">[]) => attend.some((t) => t.status !== "fait");

/**
 * Remplace la liste des tâches attendues par `todoId`.
 * Refuse : la tâche elle-même, une tâche inconnue, et toute boucle (A attend B qui attend A, directement ou non).
 */
export async function setDependencies(db: Db, todoId: string, rawIds: string[], actor?: Actor): Promise<void> {
  const ids = [...new Set(rawIds)];
  if (ids.length > DEPENDENCIES_MAX) throw new DomainError(`${DEPENDENCIES_MAX} tâches attendues au plus`);
  if (ids.includes(todoId)) throw new DomainError("Une tâche ne peut pas s'attendre elle-même");
  await db.transaction(async (tx) => {
    // Deux modifications simultanées ne doivent pas créer une boucle à elles deux
    await tx.execute(sql`LOCK TABLE todo_dependencies IN SHARE ROW EXCLUSIVE MODE`);
    const [me] = await tx.select({ id: todos.id, title: todos.title, objectId: todos.objectId }).from(todos).where(eq(todos.id, todoId));
    if (!me) throw new DomainError("Tâche introuvable");
    const found = ids.length ? await tx.select({ id: todos.id, title: todos.title }).from(todos).where(inArray(todos.id, ids)) : [];
    if (found.length !== ids.length) throw new DomainError("Une des tâches attendues est introuvable");
    const title = new Map(found.map((t) => [t.id, t.title]));

    const before = await tx.select({ id: todoDependencies.dependsOnId }).from(todoDependencies).where(eq(todoDependencies.todoId, todoId));
    const beforeIds = new Set(before.map((b) => b.id));
    const added = ids.filter((id) => !beforeIds.has(id));
    const removed = [...beforeIds].filter((id) => !ids.includes(id));
    if (!added.length && !removed.length) return;

    // Boucle : une tâche ajoutée attend-elle déjà, directement ou non, la tâche modifiée ?
    if (added.length) {
      const res = await tx.execute<{ start: string }>(sql`
        WITH RECURSIVE chain(start, id) AS (
          SELECT d.todo_id, d.depends_on_id FROM todo_dependencies d WHERE d.todo_id IN (${sql.join(added.map((a) => sql`${a}::uuid`), sql`, `)})
          UNION
          SELECT c.start, d.depends_on_id FROM chain c JOIN todo_dependencies d ON d.todo_id = c.id
        )
        SELECT start FROM chain WHERE id = ${todoId}::uuid LIMIT 1`);
      const rows = (Array.isArray(res) ? res : (res as { rows: { start: string }[] }).rows) as { start: string }[];
      if (rows.length) {
        throw new DomainError(`Boucle : « ${title.get(rows[0].start)} » attend déjà, directement ou non, « ${me.title} »`);
      }
    }

    if (removed.length) {
      await tx.delete(todoDependencies).where(and(eq(todoDependencies.todoId, todoId), inArray(todoDependencies.dependsOnId, removed)));
    }
    if (added.length) await tx.insert(todoDependencies).values(added.map((d) => ({ todoId, dependsOnId: d })));

    const names = async (list: string[]) =>
      list.length ? (await tx.select({ title: todos.title }).from(todos).where(inArray(todos.id, list))).map((t) => t.title) : [];
    await logAction(tx, actor, {
      target: todoTarget(me),
      action: "dependances",
      details: { ajoutees: await names(added), retirees: await names(removed) },
    });
  });
}

/** Liens entre les tâches données (pour dessiner les flèches du Gantt). */
export async function dependencyEdges(db: Db, todoIds: string[]): Promise<{ todoId: string; dependsOnId: string }[]> {
  if (!todoIds.length) return [];
  return db
    .select({ todoId: todoDependencies.todoId, dependsOnId: todoDependencies.dependsOnId })
    .from(todoDependencies)
    .where(and(inArray(todoDependencies.todoId, todoIds), inArray(todoDependencies.dependsOnId, todoIds)));
}

/**
 * Tâches qui deviennent prêtes parce que `doneId` vient d'être faite :
 * elles l'attendaient, ne sont pas faites, et n'attendent plus aucune tâche ouverte.
 */
export async function newlyReady(db: Db, doneId: string): Promise<Pick<Todo, "id" | "title" | "assigneeId" | "createdById">[]> {
  return db
    .select({ id: todos.id, title: todos.title, assigneeId: todos.assigneeId, createdById: todos.createdById })
    .from(todoDependencies)
    .innerJoin(todos, eq(todos.id, todoDependencies.todoId))
    .where(
      and(
        eq(todoDependencies.dependsOnId, doneId),
        sql`${todos.status} <> 'fait'`,
        sql`NOT EXISTS (SELECT 1 FROM todo_dependencies d2 JOIN todos p ON p.id = d2.depends_on_id
              WHERE d2.todo_id = ${todos.id} AND p.status <> 'fait')`,
      ),
    );
}
