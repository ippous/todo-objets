// Accès aux données. Chaque fonction reçoit la base en paramètre
// pour pouvoir être testée sur une base en mémoire.
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import {
  apiTokens,
  auditLog,
  documentTypes,
  documents,
  links,
  oauthClients,
  objectTypes,
  objects,
  photos,
  subtasks,
  todos,
  users,
  type DocumentRow,
  type ObjectBase,
  type LinkRow,
  type NewObject,
  type NewTodo,
  type ObjectRow,
  type Photo,
  type Subtask,
  type Todo,
} from "@/db/schema";
import {
  diff,
  logAction,
  objectSnapshot,
  objectTarget,
  ownerOf,
  ownerTarget,
  todoSnapshot,
  todoTarget,
  type Actor,
} from "./audit";
import { emptyStats, nextDueDate, pathTo, round2, type Recurrence, type Stats } from "./tree";

export class DomainError extends Error {}

// ---------- Objets ----------

const objectWithType = () => ({
  id: objects.id,
  name: objects.name,
  parentId: objects.parentId,
  typeId: objects.typeId,
  type: objectTypes.name,
  description: objects.description,
  location: objects.location,
  tags: objects.tags,
  position: objects.position,
  createdAt: objects.createdAt,
  updatedAt: objects.updatedAt,
});

export async function listObjects(db: Db): Promise<ObjectRow[]> {
  return db
    .select(objectWithType())
    .from(objects)
    .leftJoin(objectTypes, eq(objectTypes.id, objects.typeId))
    .orderBy(asc(objects.position), asc(objects.name));
}

export async function getObject(db: Db, id: string): Promise<ObjectRow | undefined> {
  const [row] = await db
    .select(objectWithType())
    .from(objects)
    .leftJoin(objectTypes, eq(objectTypes.id, objects.typeId))
    .where(eq(objects.id, id));
  return row;
}

/** Identifiants de l'objet et de tous ses descendants (requête récursive). */
export async function subtreeIdsDb(db: Db, rootId: string): Promise<string[]> {
  const res = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE sub AS (
      SELECT id FROM objects WHERE id = ${rootId}
      UNION
      SELECT o.id FROM objects o JOIN sub ON o.parent_id = sub.id
    )
    SELECT id FROM sub`);
  return rowsOf<{ id: string }>(res).map((r) => r.id);
}

export async function createObject(db: Db, data: NewObject, actor?: Actor): Promise<ObjectBase> {
  const parent = data.parentId ? await getObject(db, data.parentId) : undefined;
  if (data.parentId && !parent) throw new DomainError("Objet parent introuvable");
  const [row] = await db.insert(objects).values(data).returning();
  await logAction(db, actor, { target: objectTarget(row), action: "creation", details: parent ? { parent: parent.name } : null });
  return row;
}

export const BULK_MAX = 50;

/** Crée plusieurs objets d'un coup sous le même parent (ou en racines), dans l'ordre saisi. */
export async function createObjects(
  db: Db,
  parentId: string | null,
  names: string[],
  common: { typeId?: string | null } = {},
  actor?: Actor,
): Promise<ObjectBase[]> {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) throw new DomainError("Saisis au moins un nom");
  if (clean.length > BULK_MAX) throw new DomainError(`${BULK_MAX} objets au maximum à la fois`);
  if (clean.some((n) => n.length > 120)) throw new DomainError("Un nom dépasse 120 caractères");
  return db.transaction(async (tx) => {
    let parentName: string | null = null;
    if (parentId) {
      const [parent] = await tx.select({ name: objects.name }).from(objects).where(eq(objects.id, parentId)).for("update");
      if (!parent) throw new DomainError("Objet parent introuvable");
      parentName = parent.name;
    }
    const [{ max }] = await tx
      .select({ max: sql<number | null>`max(${objects.position})` })
      .from(objects)
      .where(parentId ? eq(objects.parentId, parentId) : isNull(objects.parentId));
    const start = (max ?? -1) + 1;
    const rows = await tx
      .insert(objects)
      .values(clean.map((name, i) => ({ name, parentId, typeId: common.typeId || null, position: start + i })))
      .returning();
    await logAction(
      tx,
      actor,
      ...rows.map((o) => ({ target: objectTarget(o), action: "creation" as const, details: { lot: true, ...(parentName ? { parent: parentName } : {}) } })),
    );
    return rows;
  });
}

/** Crée plusieurs tâches d'un coup sur le même objet, avec des réglages communs. */
export async function createTodos(
  db: Db,
  objectId: string,
  titles: string[],
  common: Pick<NewTodo, "category" | "priority" | "assigneeId" | "dueDate" | "createdById"> = {},
  actor?: Actor,
): Promise<Todo[]> {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) throw new DomainError("Saisis au moins un titre");
  if (clean.length > BULK_MAX) throw new DomainError(`${BULK_MAX} tâches au maximum à la fois`);
  if (clean.some((t) => t.length > 200)) throw new DomainError("Un titre dépasse 200 caractères");
  return db.transaction(async (tx) => {
    const [obj] = await tx.select({ name: objects.name }).from(objects).where(eq(objects.id, objectId)).for("update");
    if (!obj) throw new DomainError("Objet introuvable");
    const rows = await tx
      .insert(todos)
      .values(clean.map((title) => ({ ...common, objectId, title })))
      .returning();
    await logAction(
      tx,
      actor,
      ...rows.map((t) => ({ target: todoTarget(t), action: "creation" as const, details: { lot: true, objet: obj.name } })),
    );
    return rows;
  });
}

export async function updateObject(
  db: Db,
  id: string,
  data: Pick<NewObject, "name" | "typeId" | "description" | "location" | "tags">,
  actor?: Actor,
): Promise<void> {
  const before = actor ? await getObject(db, id) : undefined;
  await db.update(objects).set({ ...data, updatedAt: new Date() }).where(eq(objects.id, id));
  const after = before ? await getObject(db, id) : undefined;
  if (!before || !after) return;
  const changements = diff(objectSnapshot(before), objectSnapshot(after));
  if (Object.keys(changements).length) await logAction(db, actor, { target: objectTarget(after), action: "modification", details: { changements } });
}

/**
 * Déplace un objet (et tout son sous-arbre) sous un nouveau parent,
 * ou en racine si newParentId est null. Refuse les boucles.
 */
export async function moveObject(db: Db, id: string, newParentId: string | null, actor?: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    // Sérialise les déplacements concurrents pour qu'aucune boucle ne passe entre deux vérifications.
    await tx.execute(sql`LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE`);
    const [obj] = await tx.select().from(objects).where(eq(objects.id, id));
    if (!obj) throw new DomainError("Objet introuvable");
    let parentName: string | null = null;
    if (newParentId) {
      const [parent] = await tx.select({ name: objects.name }).from(objects).where(eq(objects.id, newParentId));
      if (!parent) throw new DomainError("Nouveau parent introuvable");
      parentName = parent.name;
      const res = await tx.execute<{ found: number }>(sql`
        WITH RECURSIVE sub AS (
          SELECT id FROM objects WHERE id = ${id}
          UNION
          SELECT o.id FROM objects o JOIN sub ON o.parent_id = sub.id
        )
        SELECT 1 AS found FROM sub WHERE id = ${newParentId}`);
      if (rowsOf<{ found: number }>(res).length > 0) {
        throw new DomainError("Impossible de placer un objet sous lui-même ou sous l'un de ses descendants");
      }
    }
    await tx.update(objects).set({ parentId: newParentId, updatedAt: new Date() }).where(eq(objects.id, id));
    if (obj.parentId === newParentId) return;
    const [old] = obj.parentId ? await tx.select({ name: objects.name }).from(objects).where(eq(objects.id, obj.parentId)) : [];
    await logAction(tx, actor, { target: objectTarget(obj), action: "deplacement", details: { de: old?.name ?? null, vers: parentName } });
  });
}

/**
 * Supprime un objet sans sous-objet ni tâche. Ses photos sont supprimées avec lui ;
 * retourne les chemins des fichiers à effacer du stockage.
 */
export async function deleteObject(db: Db, id: string, actor?: Actor): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE`);
    const [obj] = await tx.select({ id: objects.id, name: objects.name }).from(objects).where(eq(objects.id, id));
    if (!obj) throw new DomainError("Objet introuvable");
    const [child] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.parentId, id)).limit(1);
    if (child) throw new DomainError("Cet objet contient des sous-objets : déplace-les ou supprime-les d'abord");
    const [todo] = await tx.select({ id: todos.id }).from(todos).where(eq(todos.objectId, id)).limit(1);
    if (todo) throw new DomainError("Cet objet a des tâches : supprime-les ou rattache-les à un autre objet d'abord");
    const files = await tx
      .select({ p: photos.pathname, t: photos.thumbPathname })
      .from(photos)
      .where(eq(photos.objectId, id));
    const docs = await tx.select({ p: documents.pathname }).from(documents).where(eq(documents.objectId, id));
    await tx.delete(objects).where(eq(objects.id, id));
    await logAction(tx, actor, { target: objectTarget(obj), action: "suppression" });
    return [...files.flatMap((f) => [f.p, f.t]), ...docs.map((d) => d.p)];
  });
}

/** Nombre total de tâches (toutes, y compris faites) par objet. */
export async function todoCountByObject(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ objectId: todos.objectId, n: sql<number>`count(*)::int` })
    .from(todos)
    .groupBy(todos.objectId);
  return new Map(rows.map((r) => [r.objectId, Number(r.n)]));
}

/** Statistiques propres à chaque objet (tâches non terminées uniquement). */
export async function openStatsByObject(db: Db): Promise<Map<string, Stats>> {
  const rows = await db
    .select({
      objectId: todos.objectId,
      openCount: sql<number>`count(*)::int`,
      estHours: sql<string | null>`sum(${todos.estHours})`,
      estValueEur: sql<string | null>`sum(${todos.estValueEur})`,
    })
    .from(todos)
    .where(ne(todos.status, "fait"))
    .groupBy(todos.objectId);
  const map = new Map<string, Stats>();
  for (const r of rows) {
    map.set(r.objectId, {
      openCount: Number(r.openCount),
      estHours: round2(Number(r.estHours ?? 0)),
      estValueEur: round2(Number(r.estValueEur ?? 0)),
    });
  }
  return map;
}

// ---------- Tâches ----------

export type TodoFilters = {
  statuses?: Todo["status"][];
  assigneeId?: string | "none";
  category?: Todo["category"];
  priority?: Todo["priority"];
  tag?: string;
  subtreeOf?: string;
  dueBefore?: string;
  q?: string;
};

export type TodoSort = "echeance" | "priorite" | "ratio" | "recent";

export type TodoListItem = Todo & {
  objectName: string;
  assigneeName: string | null;
  createdByName: string | null;
  valuePerHour: number | null;
  coverPhotoId: string | null;
};

const priorityRank = sql`CASE ${todos.priority} WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END`;
const ratioExpr = sql<string | null>`${todos.estValueEur} / NULLIF(${todos.estHours}, 0)`;

export async function listTodos(db: Db, filters: TodoFilters = {}, sort: TodoSort = "echeance"): Promise<TodoListItem[]> {
  const conds: SQL[] = [];
  if (filters.statuses?.length) conds.push(inArray(todos.status, filters.statuses));
  if (filters.assigneeId === "none") conds.push(isNull(todos.assigneeId));
  else if (filters.assigneeId) conds.push(eq(todos.assigneeId, filters.assigneeId));
  if (filters.category) conds.push(eq(todos.category, filters.category));
  if (filters.priority) conds.push(eq(todos.priority, filters.priority));
  if (filters.tag) conds.push(sql`${filters.tag} = ANY(${todos.tags})`);
  if (filters.dueBefore) conds.push(lte(todos.dueDate, filters.dueBefore));
  if (filters.q) {
    const like = `%${filters.q}%`;
    // La description est du HTML : on cherche dans le texte, pas dans les balises
    conds.push(
      sql`(${todos.title} ILIKE ${like} OR regexp_replace(coalesce(${todos.description}, ''), '<[^>]*>', ' ', 'g') ILIKE ${like})`,
    );
  }
  if (filters.subtreeOf) {
    conds.push(sql`${todos.objectId} IN (
      WITH RECURSIVE sub AS (
        SELECT id FROM objects WHERE id = ${filters.subtreeOf}
        UNION
        SELECT o.id FROM objects o JOIN sub ON o.parent_id = sub.id
      ) SELECT id FROM sub)`);
  }

  const orderBy: SQL[] = [];
  // Les tâches terminées en dernier, quel que soit le tri
  orderBy.push(sql`CASE WHEN ${todos.status} = 'fait' THEN 1 ELSE 0 END`);
  if (sort === "echeance") orderBy.push(sql`${todos.dueDate} ASC NULLS LAST`, priorityRank);
  if (sort === "priorite") orderBy.push(priorityRank, sql`${todos.dueDate} ASC NULLS LAST`);
  if (sort === "ratio") orderBy.push(sql`${ratioExpr} DESC NULLS LAST`, priorityRank);
  if (sort === "recent") orderBy.push(desc(todos.createdAt));
  orderBy.push(asc(todos.title));

  const assignee = alias(users, "assignee");
  const creator = alias(users, "creator");
  const rows = await db
    .select({
      todo: todos,
      objectName: objects.name,
      assigneeName: assignee.name,
      createdByName: creator.name,
      ratio: ratioExpr,
      coverPhotoId: sql<string | null>`(SELECT p.id FROM photos p WHERE p.todo_id = ${todos.id} AND p.is_cover LIMIT 1)`,
    })
    .from(todos)
    .innerJoin(objects, eq(objects.id, todos.objectId))
    .leftJoin(assignee, eq(assignee.id, todos.assigneeId))
    .leftJoin(creator, eq(creator.id, todos.createdById))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(...orderBy);

  return rows.map((r) => ({
    ...r.todo,
    objectName: r.objectName,
    assigneeName: r.assigneeName,
    createdByName: r.createdByName,
    valuePerHour: r.ratio == null ? null : round2(Number(r.ratio)),
    coverPhotoId: r.coverPhotoId ?? null,
  }));
}

export async function getTodo(db: Db, id: string): Promise<Todo | undefined> {
  const [row] = await db.select().from(todos).where(eq(todos.id, id));
  return row;
}

export async function createTodo(db: Db, data: NewTodo, actor?: Actor): Promise<Todo> {
  const obj = await getObject(db, data.objectId);
  if (!obj) throw new DomainError("Objet introuvable");
  const [row] = await db.insert(todos).values(data).returning();
  await logAction(db, actor, { target: todoTarget(row), action: "creation", details: { objet: obj.name } });
  return row;
}

export async function updateTodo(db: Db, id: string, data: Partial<NewTodo>, actor?: Actor): Promise<void> {
  if (data.objectId) {
    const obj = await getObject(db, data.objectId);
    if (!obj) throw new DomainError("Objet introuvable");
  }
  const before = actor ? await getTodo(db, id) : undefined;
  await db.update(todos).set({ ...data, updatedAt: new Date() }).where(eq(todos.id, id));
  const after = before ? await getTodo(db, id) : undefined;
  if (!before || !after) return;
  const changements = diff(await todoSnapshot(db, before), await todoSnapshot(db, after));
  if (Object.keys(changements).length) await logAction(db, actor, { target: todoTarget(after), action: "modification", details: { changements } });
}

/** Supprime une tâche et ses photos ; retourne les chemins des fichiers à effacer. */
export async function deleteTodo(db: Db, id: string, actor?: Actor): Promise<string[]> {
  const todo = await getTodo(db, id);
  const files = await db
    .select({ p: photos.pathname, t: photos.thumbPathname })
    .from(photos)
    .where(eq(photos.todoId, id));
  const docs = await db.select({ p: documents.pathname }).from(documents).where(eq(documents.todoId, id));
  await db.delete(todos).where(eq(todos.id, id));
  if (todo) await logAction(db, actor, { target: todoTarget(todo), action: "suppression" });
  return [...files.flatMap((f) => [f.p, f.t]), ...docs.map((d) => d.p)];
}

/**
 * Change le statut d'une tâche. Au passage à « fait », enregistre le réalisé et,
 * si la tâche est récurrente, crée l'occurrence suivante (une seule fois).
 * Retourne l'identifiant de la nouvelle occurrence éventuelle.
 */
export async function setTodoStatus(
  db: Db,
  id: string,
  status: Todo["status"],
  opts: { actualHours?: number | null; actualValueEur?: number | null; today?: string; actor?: Actor } = {},
): Promise<string | null> {
  const { actor, today = new Date().toISOString().slice(0, 10) } = opts;
  return db.transaction(async (tx) => {
    const [todo] = await tx.select().from(todos).where(eq(todos.id, id)).for("update");
    if (!todo) throw new DomainError("Tâche introuvable");

    if (status !== "fait") {
      await tx
        .update(todos)
        .set({ status, doneAt: null, updatedAt: new Date() })
        .where(eq(todos.id, id));
      if (todo.status !== status) {
        await logAction(tx, actor, {
          target: todoTarget(todo),
          action: "changement_statut",
          details: { changements: { statut: { avant: todo.status, apres: status } } },
        });
      }
      return null;
    }

    const actualHours = opts.actualHours ?? todo.actualHours;
    const actualValueEur = opts.actualValueEur ?? todo.actualValueEur;
    await tx
      .update(todos)
      .set({
        status,
        doneAt: todo.doneAt ?? new Date(),
        actualHours,
        actualValueEur,
        updatedAt: new Date(),
      })
      .where(eq(todos.id, id));
    const changements = diff(
      { statut: todo.status, heures_realisees: todo.actualHours, valeur_realisee_eur: todo.actualValueEur },
      { statut: status, heures_realisees: actualHours, valeur_realisee_eur: actualValueEur },
    );
    if (Object.keys(changements).length) {
      await logAction(tx, actor, { target: todoTarget(todo), action: "changement_statut", details: { changements } });
    }

    if (todo.recurrence === "aucune") return null;
    const [existing] = await tx
      .select({ id: todos.id })
      .from(todos)
      .where(eq(todos.previousOccurrenceId, id))
      .limit(1);
    if (existing) return null;

    const due = nextDueDate(todo.dueDate, today, todo.recurrence as Recurrence);
    const [next] = await tx
      .insert(todos)
      .values({
        objectId: todo.objectId,
        title: todo.title,
        description: todo.description,
        category: todo.category,
        priority: todo.priority,
        estHours: todo.estHours,
        estValueEur: todo.estValueEur,
        dueDate: due,
        recurrence: todo.recurrence,
        assigneeId: todo.assigneeId,
        tags: todo.tags,
        createdById: todo.createdById,
        previousOccurrenceId: todo.id,
      })
      .returning({ id: todos.id });
    await logAction(tx, actor, {
      target: todoTarget({ id: next.id, title: todo.title, objectId: todo.objectId }),
      action: "creation",
      details: { occurrence_de: todo.title, echeance: due },
    });
    // La nouvelle occurrence reprend les sous-tâches, toutes décochées
    const subs = await tx.select().from(subtasks).where(eq(subtasks.todoId, id)).orderBy(asc(subtasks.position));
    if (subs.length) {
      await tx.insert(subtasks).values(subs.map((st) => ({ todoId: next.id, title: st.title, position: st.position })));
    }
    return next.id;
  });
}

export type Totals = { count: number; open: Stats; done: { count: number; actualHours: number; actualValueEur: number; estHours: number; estValueEur: number } };

export function computeTotals(list: Todo[]): Totals {
  const open = emptyStats();
  const done = { count: 0, actualHours: 0, actualValueEur: 0, estHours: 0, estValueEur: 0 };
  for (const t of list) {
    if (t.status === "fait") {
      done.count++;
      done.actualHours += t.actualHours ?? 0;
      done.actualValueEur += t.actualValueEur ?? 0;
      done.estHours += t.estHours ?? 0;
      done.estValueEur += t.estValueEur ?? 0;
    } else {
      open.openCount++;
      open.estHours += t.estHours ?? 0;
      open.estValueEur += t.estValueEur ?? 0;
    }
  }
  return {
    count: list.length,
    open: { openCount: open.openCount, estHours: round2(open.estHours), estValueEur: round2(open.estValueEur) },
    done: {
      count: done.count,
      actualHours: round2(done.actualHours),
      actualValueEur: round2(done.actualValueEur),
      estHours: round2(done.estHours),
      estValueEur: round2(done.estValueEur),
    },
  };
}

export async function listAllTags(db: Db): Promise<string[]> {
  const res = await db.execute<{ tag: string }>(sql`
    SELECT DISTINCT tag FROM (
      SELECT unnest(tags) AS tag FROM todos
      UNION SELECT unnest(tags) AS tag FROM objects
    ) t ORDER BY tag`);
  return rowsOf<{ tag: string }>(res).map((r) => r.tag);
}

// ---------- Recherche d'objets ----------

/** Minuscules sans accents ni espaces multiples, pour comparer « écurie » et « ECURIE ». */
export const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

export type ObjectSearchHit = { id: string; name: string; type: string | null; path: string };

/**
 * Cherche un texte dans les objets (nom, type, lieu, tags, description), sans tenir
 * compte de la casse ni des accents. Les noms qui commencent par le texte d'abord,
 * puis ceux qui le contiennent, puis les autres champs.
 */
export async function searchObjects(db: Db, rawQuery: string, limit = 10): Promise<{ hits: ObjectSearchHit[]; total: number }> {
  const q = foldText(rawQuery.trim().slice(0, 100));
  if (!q) return { hits: [], total: 0 };
  const objs = await listObjects(db);
  const matches = objs
    .map((o) => {
      const name = foldText(o.name);
      const other = foldText([o.type ?? "", o.location ?? "", o.tags.join(" "), (o.description ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")].join(" "));
      const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : other.includes(q) ? 2 : -1;
      return { o, rank };
    })
    .filter((m) => m.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.o.name.localeCompare(b.o.name, "fr"));
  return {
    hits: matches.slice(0, limit).map(({ o }) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      path: pathTo(objs, o.id)
        .slice(0, -1)
        .map((p) => p.name)
        .join(" › "),
    })),
    total: matches.length,
  };
}

// ---------- Utilisateurs ----------

export async function listUsers(db: Db) {
  return db.select().from(users).orderBy(asc(users.name));
}

export async function getUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  return row;
}

export async function getUser(db: Db, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function createUser(
  db: Db,
  data: { email: string; name: string; role?: "admin" | "membre"; weeklyHoursAvailable?: number | null; skills?: string | null },
) {
  const email = data.email.trim().toLowerCase();
  if (await getUserByEmail(db, email)) throw new DomainError("Cette adresse est déjà autorisée");
  const [row] = await db.insert(users).values({ ...data, email }).returning();
  return row;
}

export async function updateUser(
  db: Db,
  id: string,
  data: Partial<{ name: string; role: "admin" | "membre"; weeklyHoursAvailable: number | null; skills: string | null; active: boolean }>,
) {
  if (data.role === "membre" || data.active === false) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, id)));
    const target = await getUser(db, id);
    if (target?.role === "admin" && admins.length === 0) {
      throw new DomainError("Il doit rester au moins un administrateur actif");
    }
  }
  await db.update(users).set(data).where(eq(users.id, id));
}

/** Crée les administrateurs listés dans ADMIN_EMAILS s'ils n'existent pas encore. */
export async function ensureAdmins(db: Db, emails: string[]) {
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    const existing = await getUserByEmail(db, email);
    if (!existing) await db.insert(users).values({ email, name: email.split("@")[0], role: "admin" });
  }
}

// ---------- Photos ----------

export type PhotoOwner = { objectId: string } | { todoId: string };

const ownerCond = (o: PhotoOwner) =>
  "objectId" in o ? eq(photos.objectId, o.objectId) : eq(photos.todoId, o.todoId);

export async function listPhotos(db: Db, owner: PhotoOwner): Promise<Photo[]> {
  return db
    .select()
    .from(photos)
    .where(ownerCond(owner))
    .orderBy(desc(photos.isCover), asc(photos.createdAt));
}

export async function getPhoto(db: Db, id: string): Promise<Photo | undefined> {
  const [row] = await db.select().from(photos).where(eq(photos.id, id));
  return row;
}

/** Ajoute une photo ; la première photo d'un objet ou d'une tâche devient sa vignette. */
export async function addPhoto(
  db: Db,
  owner: PhotoOwner,
  data: { pathname: string; thumbPathname: string; width?: number | null; height?: number | null; createdById?: string | null },
  actor?: Actor,
): Promise<Photo> {
  return db.transaction(async (tx) => {
    if ("objectId" in owner) {
      const [o] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, owner.objectId)).for("update");
      if (!o) throw new DomainError("Objet introuvable");
    } else {
      const [t] = await tx.select({ id: todos.id }).from(todos).where(eq(todos.id, owner.todoId)).for("update");
      if (!t) throw new DomainError("Tâche introuvable");
    }
    const [cover] = await tx
      .select({ id: photos.id })
      .from(photos)
      .where(and(ownerCond(owner), eq(photos.isCover, true)))
      .limit(1);
    const [row] = await tx
      .insert(photos)
      .values({ ...data, ...owner, isCover: !cover })
      .returning();
    const target = await ownerTarget(tx, owner);
    if (target) await logAction(tx, actor, { target, action: "ajout_photo" });
    return row;
  });
}

/** Fait de cette photo la vignette de son objet ou de sa tâche. */
export async function setCoverPhoto(db: Db, id: string, actor?: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(photos).where(eq(photos.id, id)).for("update");
    if (!p) throw new DomainError("Photo introuvable");
    const owner: PhotoOwner = p.objectId ? { objectId: p.objectId } : { todoId: p.todoId! };
    await tx.update(photos).set({ isCover: false }).where(and(ownerCond(owner), eq(photos.isCover, true)));
    await tx.update(photos).set({ isCover: true }).where(eq(photos.id, id));
    const target = await ownerTarget(tx, owner);
    if (target) await logAction(tx, actor, { target, action: "choix_vignette" });
  });
}

/**
 * Supprime une photo. Si c'était la vignette, la plus ancienne des photos restantes
 * prend le relais. Retourne les chemins des fichiers à effacer.
 */
export async function deletePhoto(db: Db, id: string, actor?: Actor): Promise<string[]> {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(photos).where(eq(photos.id, id)).for("update");
    if (!p) throw new DomainError("Photo introuvable");
    await tx.delete(photos).where(eq(photos.id, id));
    if (p.isCover) {
      const owner: PhotoOwner = p.objectId ? { objectId: p.objectId } : { todoId: p.todoId! };
      const [next] = await tx
        .select({ id: photos.id })
        .from(photos)
        .where(ownerCond(owner))
        .orderBy(asc(photos.createdAt))
        .limit(1);
      if (next) await tx.update(photos).set({ isCover: true }).where(eq(photos.id, next.id));
    }
    const target = await ownerTarget(tx, ownerOf(p));
    if (target) await logAction(tx, actor, { target, action: "suppression_photo" });
    return [p.pathname, p.thumbPathname];
  });
}

/** Vignette (identifiant de photo) de chaque objet qui en a une. */
export async function objectCovers(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ objectId: photos.objectId, id: photos.id })
    .from(photos)
    .where(and(eq(photos.isCover, true), sql`${photos.objectId} IS NOT NULL`));
  return new Map(rows.map((r) => [r.objectId!, r.id]));
}

// ---------- Documents ----------

export type AttachmentOwner = { objectId: string } | { todoId: string };

const docOwnerCond = (o: AttachmentOwner) =>
  "objectId" in o ? eq(documents.objectId, o.objectId) : eq(documents.todoId, o.todoId);
const linkOwnerCond = (o: AttachmentOwner) =>
  "objectId" in o ? eq(links.objectId, o.objectId) : eq(links.todoId, o.todoId);

async function assertOwner(db: Db, o: AttachmentOwner) {
  if ("objectId" in o) {
    if (!(await getObject(db, o.objectId))) throw new DomainError("Objet introuvable");
  } else if (!(await getTodo(db, o.todoId))) throw new DomainError("Tâche introuvable");
}

export async function listDocuments(db: Db, owner: AttachmentOwner): Promise<(DocumentRow & { typeName: string })[]> {
  const rows = await db
    .select({ doc: documents, typeName: documentTypes.name })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.typeId))
    .where(docOwnerCond(owner))
    .orderBy(asc(documentTypes.name), desc(documents.createdAt));
  return rows.map((r) => ({ ...r.doc, typeName: r.typeName }));
}

export async function getDocument(db: Db, id: string): Promise<DocumentRow | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

export async function addDocument(
  db: Db,
  data: {
    owner: AttachmentOwner;
    typeId: string;
    pathname: string;
    filename: string;
    contentType: string;
    size: number;
    createdById?: string | null;
  },
  actor?: Actor,
): Promise<DocumentRow> {
  await assertOwner(db, data.owner);
  const [t] = await db.select({ name: documentTypes.name }).from(documentTypes).where(eq(documentTypes.id, data.typeId));
  if (!t) throw new DomainError("Type de document introuvable");
  const filename = data.filename.trim().slice(0, 200) || "document";
  const { owner, ...rest } = data;
  const [row] = await db
    .insert(documents)
    .values({ ...rest, ...owner, filename })
    .returning();
  const target = await ownerTarget(db, owner);
  if (target) await logAction(db, actor, { target, action: "ajout_document", details: { fichier: filename, type: t.name } });
  return row;
}

/** Supprime un document ; retourne le chemin du fichier à effacer. */
export async function deleteDocument(db: Db, id: string, actor?: Actor): Promise<string> {
  const [row] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ p: documents.pathname, objectId: documents.objectId, todoId: documents.todoId, filename: documents.filename });
  if (!row) throw new DomainError("Document introuvable");
  const target = await ownerTarget(db, ownerOf(row));
  if (target) await logAction(db, actor, { target, action: "suppression_document", details: { fichier: row.filename } });
  return row.p;
}

/** Change le type d'un document. */
export async function setDocumentType(db: Db, id: string, typeId: string, actor?: Actor): Promise<void> {
  const [t] = await db.select({ name: documentTypes.name }).from(documentTypes).where(eq(documentTypes.id, typeId));
  if (!t) throw new DomainError("Type de document introuvable");
  const [row] = await db
    .update(documents)
    .set({ typeId })
    .where(eq(documents.id, id))
    .returning({ objectId: documents.objectId, todoId: documents.todoId, filename: documents.filename });
  if (!row) throw new DomainError("Document introuvable");
  const target = await ownerTarget(db, ownerOf(row));
  if (target) await logAction(db, actor, { target, action: "type_document", details: { fichier: row.filename, type: t.name } });
}

// ---------- Types (objets et documents) ----------

export type TypeKind = "objet" | "document";
const typeTable = (k: TypeKind) => (k === "objet" ? objectTypes : documentTypes);
const usageTable = (k: TypeKind) => (k === "objet" ? objects : documents);

export type TypeWithUsage = { id: string; name: string; usage: number };

export async function listTypes(db: Db, kind: TypeKind): Promise<TypeWithUsage[]> {
  const t = typeTable(kind);
  const u = usageTable(kind);
  const rows = await db
    .select({ id: t.id, name: t.name, usage: sql<number>`count(${u.id})::int` })
    .from(t)
    .leftJoin(u, eq(u.typeId, t.id))
    .groupBy(t.id, t.name)
    .orderBy(sql`lower(${t.name})`);
  return rows.map((r) => ({ ...r, usage: Number(r.usage) }));
}

function cleanTypeName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new DomainError("Saisis un nom de type");
  if (n.length > 60) throw new DomainError("60 caractères au maximum");
  return n;
}

async function assertUniqueName(db: Db, kind: TypeKind, name: string, exceptId?: string) {
  const t = typeTable(kind);
  const [dup] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(sql`lower(${t.name}) = lower(${name})`, exceptId ? ne(t.id, exceptId) : undefined))
    .limit(1);
  if (dup) throw new DomainError(`Le type « ${name} » existe déjà`);
}

export async function createType(db: Db, kind: TypeKind, rawName: string): Promise<{ id: string; name: string }> {
  const name = cleanTypeName(rawName);
  await assertUniqueName(db, kind, name);
  const t = typeTable(kind);
  const [row] = await db.insert(t).values({ name }).returning({ id: t.id, name: t.name });
  return row;
}

export async function renameType(db: Db, kind: TypeKind, id: string, rawName: string): Promise<void> {
  const name = cleanTypeName(rawName);
  await assertUniqueName(db, kind, name, id);
  const t = typeTable(kind);
  const [row] = await db.update(t).set({ name }).where(eq(t.id, id)).returning({ id: t.id });
  if (!row) throw new DomainError("Type introuvable");
}

/** Supprime un type, uniquement s'il n'est utilisé par aucun objet ou document. */
export async function deleteType(db: Db, kind: TypeKind, id: string): Promise<void> {
  const t = typeTable(kind);
  const u = usageTable(kind);
  await db.transaction(async (tx) => {
    const [type] = await tx.select({ id: t.id, name: t.name }).from(t).where(eq(t.id, id)).for("update");
    if (!type) throw new DomainError("Type introuvable");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(u).where(eq(u.typeId, id));
    if (Number(n) > 0) {
      const what = kind === "objet" ? "objet" : "document";
      throw new DomainError(
        `Impossible de supprimer « ${type.name} » : ${n} ${what}${Number(n) > 1 ? "s l'utilisent" : " l'utilise"}`,
      );
    }
    await tx.delete(t).where(eq(t.id, id));
  });
}

/** Identifiant d'un type à partir de son nom (créé s'il n'existe pas). */
export async function typeIdByName(db: Db, kind: TypeKind, name: string): Promise<string> {
  const t = typeTable(kind);
  const [row] = await db.select({ id: t.id }).from(t).where(sql`lower(${t.name}) = lower(${name.trim()})`);
  if (row) return row.id;
  return (await createType(db, kind, name)).id;
}

// ---------- Liens ----------

/** Normalise une adresse web : ajoute https:// si besoin, refuse tout autre protocole. */
export function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) throw new DomainError("Saisis une adresse");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
  } catch {
    throw new DomainError("Adresse invalide");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new DomainError("Seules les adresses web (http, https) sont acceptées");
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new DomainError("Adresse invalide");
  if (url.href.length > 2000) throw new DomainError("Adresse trop longue");
  return url.href;
}

export async function listLinks(db: Db, owner: AttachmentOwner): Promise<LinkRow[]> {
  return db.select().from(links).where(linkOwnerCond(owner)).orderBy(asc(links.createdAt));
}

export async function addLink(
  db: Db,
  data: { owner: AttachmentOwner; url: string; title?: string | null; createdById?: string | null },
  actor?: Actor,
): Promise<LinkRow> {
  await assertOwner(db, data.owner);
  const url = normalizeUrl(data.url);
  const title = (data.title ?? "").trim().slice(0, 200) || new URL(url).hostname.replace(/^www\./, "");
  const [row] = await db
    .insert(links)
    .values({ ...data.owner, url, title, createdById: data.createdById ?? null })
    .returning();
  const target = await ownerTarget(db, data.owner);
  if (target) await logAction(db, actor, { target, action: "ajout_lien", details: { titre: title, url } });
  return row;
}

export async function deleteLink(db: Db, id: string, actor?: Actor): Promise<void> {
  const [row] = await db
    .delete(links)
    .where(eq(links.id, id))
    .returning({ objectId: links.objectId, todoId: links.todoId, url: links.url, title: links.title });
  if (!row) throw new DomainError("Lien introuvable");
  const target = await ownerTarget(db, ownerOf(row));
  if (target) await logAction(db, actor, { target, action: "suppression_lien", details: { titre: row.title, url: row.url } });
}

// ---------- Sous-tâches ----------

export const SUBTASK_MAX_LENGTH = 300;

function cleanSubtaskTitle(raw: string) {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) throw new DomainError("Saisis le texte de la sous-tâche");
  if (title.length > SUBTASK_MAX_LENGTH) throw new DomainError(`Sous-tâche trop longue (${SUBTASK_MAX_LENGTH} caractères au plus)`);
  return title;
}

export async function listSubtasks(db: Db, todoId: string): Promise<Subtask[]> {
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.todoId, todoId))
    .orderBy(asc(subtasks.position), asc(subtasks.createdAt));
}

/** Ajoute une sous-tâche en fin de liste. */
export async function addSubtask(db: Db, todoId: string, rawTitle: string, actor?: Actor): Promise<Subtask> {
  const title = cleanSubtaskTitle(rawTitle);
  const todo = await getTodo(db, todoId);
  if (!todo) throw new DomainError("Tâche introuvable");
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${subtasks.position})` })
    .from(subtasks)
    .where(eq(subtasks.todoId, todoId));
  const [row] = await db
    .insert(subtasks)
    .values({ todoId, title, position: max == null ? 0 : Number(max) + 1 })
    .returning();
  await logAction(db, actor, { target: todoTarget(todo), action: "ajout_sous_tache", details: { titre: title } });
  return row;
}

export async function updateSubtask(db: Db, id: string, data: { title?: string; done?: boolean }, actor?: Actor): Promise<void> {
  const set: Partial<Subtask> = {};
  if (data.title !== undefined) set.title = cleanSubtaskTitle(data.title);
  if (data.done !== undefined) set.done = data.done;
  const [before] = await db.select().from(subtasks).where(eq(subtasks.id, id));
  if (!before) throw new DomainError("Sous-tâche introuvable");
  const [row] = await db.update(subtasks).set(set).where(eq(subtasks.id, id)).returning();
  if (!row) throw new DomainError("Sous-tâche introuvable");
  const changements = diff({ titre: before.title, fait: before.done }, { titre: row.title, fait: row.done });
  const todo = Object.keys(changements).length && actor ? await getTodo(db, row.todoId) : undefined;
  if (todo) {
    await logAction(db, actor, { target: todoTarget(todo), action: "modification_sous_tache", details: { titre: row.title, changements } });
  }
}

export async function deleteSubtask(db: Db, id: string, actor?: Actor): Promise<void> {
  const [row] = await db.delete(subtasks).where(eq(subtasks.id, id)).returning({ todoId: subtasks.todoId, title: subtasks.title });
  if (!row) throw new DomainError("Sous-tâche introuvable");
  const todo = actor ? await getTodo(db, row.todoId) : undefined;
  if (todo) await logAction(db, actor, { target: todoTarget(todo), action: "suppression_sous_tache", details: { titre: row.title } });
}

/** Range les sous-tâches d'une tâche dans l'ordre donné (la liste complète de leurs identifiants). */
export async function reorderSubtasks(db: Db, todoId: string, orderedIds: string[], actor?: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: subtasks.id }).from(subtasks).where(eq(subtasks.todoId, todoId)).for("update");
    const current = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== current.size || new Set(orderedIds).size !== current.size || !orderedIds.every((i) => current.has(i))) {
      throw new DomainError("La liste a changé entre-temps. Recharge la page.");
    }
    for (const [position, id] of orderedIds.entries()) {
      await tx.update(subtasks).set({ position }).where(eq(subtasks.id, id));
    }
    const [todo] = actor ? await tx.select().from(todos).where(eq(todos.id, todoId)) : [];
    if (todo) await logAction(tx, actor, { target: todoTarget(todo), action: "ordre_sous_taches" });
  });
}

// ---------- Purge des données de test ----------

export const PURGE_MARKER_MIN = 4;

export type PurgeResult = { objects: number; todos: number; types: number; files: string[]; names: string[] };

/**
 * Supprime tout ce qu'un test a créé : les objets dont le nom contient `marker`
 * (avec leurs sous-arbres, tâches, photos, documents et liens), les tâches dont
 * le titre le contient, et les types inutilisés qui le contiennent.
 * Renvoie les chemins des fichiers à effacer du stockage.
 */
export async function purgeTestData(db: Db, marker: string, opts: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const m = marker.trim();
  if (m.length < PURGE_MARKER_MIN) throw new DomainError(`Marqueur trop court (${PURGE_MARKER_MIN} caractères au moins)`);
  const like = `%${m.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE`);
    const tree = rowsOf<{ id: string; depth: number }>(
      await tx.execute(sql`
        WITH RECURSIVE t(id, depth) AS (
          SELECT id, 0 FROM objects WHERE name ILIKE ${like}
          UNION
          SELECT o.id, t.depth + 1 FROM objects o JOIN t ON o.parent_id = t.id
        )
        SELECT id, max(depth)::int AS depth FROM t GROUP BY id`),
    );
    const objectIds = tree.map((r) => r.id);
    const names = (
      await tx.select({ name: objects.name }).from(objects).where(sql`${objects.name} ILIKE ${like}`)
    ).map((r) => r.name);
    const todoRows = await tx
      .select({ id: todos.id })
      .from(todos)
      .where(
        objectIds.length
          ? sql`${todos.objectId} IN ${objectIds} OR ${todos.title} ILIKE ${like}`
          : sql`${todos.title} ILIKE ${like}`,
      );
    const todoIds = todoRows.map((r) => r.id);

    if (opts.dryRun) return { objects: objectIds.length, todos: todoIds.length, types: 0, files: [], names };
    const files: string[] = [];
    if (objectIds.length || todoIds.length) {
      const owners: SQL[] = [];
      if (objectIds.length) owners.push(inArray(photos.objectId, objectIds));
      if (todoIds.length) owners.push(inArray(photos.todoId, todoIds));
      const ph = await tx
        .select({ p: photos.pathname, t: photos.thumbPathname })
        .from(photos)
        .where(sql.join(owners, sql` OR `));
      files.push(...ph.flatMap((f) => [f.p, f.t]));
    }
    if (objectIds.length) {
      const docs = await tx.select({ p: documents.pathname }).from(documents).where(inArray(documents.objectId, objectIds));
      files.push(...docs.map((d) => d.p));
    }
    if (todoIds.length) {
      const tdocs = await tx.select({ p: documents.pathname }).from(documents).where(inArray(documents.todoId, todoIds));
      files.push(...tdocs.map((d) => d.p));
      // Les occurrences récurrentes peuvent se référencer entre elles : on coupe le lien d'abord.
      await tx.update(todos).set({ previousOccurrenceId: null }).where(inArray(todos.previousOccurrenceId, todoIds));
      await tx.delete(todos).where(inArray(todos.id, todoIds));
    }
    // Du plus profond au plus haut, à cause de la contrainte parent (restrict)
    const depths = [...new Set(tree.map((r) => r.depth))].sort((a, b) => b - a);
    for (const d of depths) {
      const ids = tree.filter((r) => r.depth === d).map((r) => r.id);
      await tx.delete(objects).where(inArray(objects.id, ids));
    }

    // Jetons personnels et applications OAuth créés par les tests
    await tx.delete(auditLog).where(
      sql.join(
        [
          sql`${auditLog.entityLabel} ILIKE ${like}`,
          ...(objectIds.length ? [inArray(auditLog.entityId, objectIds), inArray(auditLog.objectId, objectIds)] : []),
          ...(todoIds.length ? [inArray(auditLog.entityId, todoIds)] : []),
        ],
        sql` OR `,
      ),
    );
    await tx.delete(apiTokens).where(sql`${apiTokens.kind} = 'personnel' AND ${apiTokens.name} ILIKE ${like}`);
    await tx.delete(oauthClients).where(sql`${oauthClients.name} ILIKE ${like}`);

    let types = 0;
    for (const [table, col] of [
      [objectTypes, sql`(SELECT count(*) FROM objects WHERE type_id = ${objectTypes.id})`],
      [documentTypes, sql`(SELECT count(*) FROM documents WHERE type_id = ${documentTypes.id})`],
    ] as const) {
      const del = await tx
        .delete(table)
        .where(sql`${table.name} ILIKE ${like} AND ${col} = 0`)
        .returning({ id: table.id });
      types += del.length;
    }
    return { objects: objectIds.length, todos: todoIds.length, types, files: files.filter(Boolean), names };
  });
}

// ---------- Utilitaire ----------

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = res as { rows?: T[] };
  return r.rows ?? [];
}
