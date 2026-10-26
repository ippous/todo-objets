// Accès aux données. Chaque fonction reçoit la base en paramètre
// pour pouvoir être testée sur une base en mémoire.
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import {
  documentTypes,
  documents,
  links,
  objectTypes,
  objects,
  photos,
  todos,
  users,
  type DocumentRow,
  type ObjectBase,
  type LinkRow,
  type NewObject,
  type NewTodo,
  type ObjectRow,
  type Photo,
  type Todo,
} from "@/db/schema";
import { emptyStats, nextDueDate, round2, type Recurrence, type Stats } from "./tree";

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

export async function createObject(db: Db, data: NewObject): Promise<ObjectBase> {
  if (data.parentId) {
    const parent = await getObject(db, data.parentId);
    if (!parent) throw new DomainError("Objet parent introuvable");
  }
  const [row] = await db.insert(objects).values(data).returning();
  return row;
}

export const BULK_MAX = 50;

/** Crée plusieurs objets d'un coup sous le même parent (ou en racines), dans l'ordre saisi. */
export async function createObjects(
  db: Db,
  parentId: string | null,
  names: string[],
  common: { typeId?: string | null } = {},
): Promise<ObjectBase[]> {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) throw new DomainError("Saisis au moins un nom");
  if (clean.length > BULK_MAX) throw new DomainError(`${BULK_MAX} objets au maximum à la fois`);
  if (clean.some((n) => n.length > 120)) throw new DomainError("Un nom dépasse 120 caractères");
  return db.transaction(async (tx) => {
    if (parentId) {
      const [parent] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, parentId)).for("update");
      if (!parent) throw new DomainError("Objet parent introuvable");
    }
    const [{ max }] = await tx
      .select({ max: sql<number | null>`max(${objects.position})` })
      .from(objects)
      .where(parentId ? eq(objects.parentId, parentId) : isNull(objects.parentId));
    const start = (max ?? -1) + 1;
    return tx
      .insert(objects)
      .values(clean.map((name, i) => ({ name, parentId, typeId: common.typeId || null, position: start + i })))
      .returning();
  });
}

/** Crée plusieurs tâches d'un coup sur le même objet, avec des réglages communs. */
export async function createTodos(
  db: Db,
  objectId: string,
  titles: string[],
  common: Pick<NewTodo, "category" | "priority" | "assigneeId" | "dueDate" | "createdById"> = {},
): Promise<Todo[]> {
  const clean = titles.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) throw new DomainError("Saisis au moins un titre");
  if (clean.length > BULK_MAX) throw new DomainError(`${BULK_MAX} tâches au maximum à la fois`);
  if (clean.some((t) => t.length > 200)) throw new DomainError("Un titre dépasse 200 caractères");
  return db.transaction(async (tx) => {
    const [obj] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).for("update");
    if (!obj) throw new DomainError("Objet introuvable");
    return tx
      .insert(todos)
      .values(clean.map((title) => ({ ...common, objectId, title })))
      .returning();
  });
}

export async function updateObject(
  db: Db,
  id: string,
  data: Pick<NewObject, "name" | "typeId" | "description" | "location" | "tags">,
): Promise<void> {
  await db.update(objects).set({ ...data, updatedAt: new Date() }).where(eq(objects.id, id));
}

/**
 * Déplace un objet (et tout son sous-arbre) sous un nouveau parent,
 * ou en racine si newParentId est null. Refuse les boucles.
 */
export async function moveObject(db: Db, id: string, newParentId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    // Sérialise les déplacements concurrents pour qu'aucune boucle ne passe entre deux vérifications.
    await tx.execute(sql`LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE`);
    const [obj] = await tx.select().from(objects).where(eq(objects.id, id));
    if (!obj) throw new DomainError("Objet introuvable");
    if (newParentId) {
      const [parent] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, newParentId));
      if (!parent) throw new DomainError("Nouveau parent introuvable");
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
  });
}

/**
 * Supprime un objet sans sous-objet ni tâche. Ses photos sont supprimées avec lui ;
 * retourne les chemins des fichiers à effacer du stockage.
 */
export async function deleteObject(db: Db, id: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE objects IN SHARE ROW EXCLUSIVE MODE`);
    const [obj] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, id));
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
    conds.push(sql`(${todos.title} ILIKE ${like} OR ${todos.description} ILIKE ${like})`);
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

export async function createTodo(db: Db, data: NewTodo): Promise<Todo> {
  const obj = await getObject(db, data.objectId);
  if (!obj) throw new DomainError("Objet introuvable");
  const [row] = await db.insert(todos).values(data).returning();
  return row;
}

export async function updateTodo(db: Db, id: string, data: Partial<NewTodo>): Promise<void> {
  if (data.objectId) {
    const obj = await getObject(db, data.objectId);
    if (!obj) throw new DomainError("Objet introuvable");
  }
  await db.update(todos).set({ ...data, updatedAt: new Date() }).where(eq(todos.id, id));
}

/** Supprime une tâche et ses photos ; retourne les chemins des fichiers à effacer. */
export async function deleteTodo(db: Db, id: string): Promise<string[]> {
  const files = await db
    .select({ p: photos.pathname, t: photos.thumbPathname })
    .from(photos)
    .where(eq(photos.todoId, id));
  await db.delete(todos).where(eq(todos.id, id));
  return files.flatMap((f) => [f.p, f.t]);
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
  actuals: { actualHours?: number | null; actualValueEur?: number | null } = {},
  today: string = new Date().toISOString().slice(0, 10),
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [todo] = await tx.select().from(todos).where(eq(todos.id, id)).for("update");
    if (!todo) throw new DomainError("Tâche introuvable");

    if (status !== "fait") {
      await tx
        .update(todos)
        .set({ status, doneAt: null, updatedAt: new Date() })
        .where(eq(todos.id, id));
      return null;
    }

    await tx
      .update(todos)
      .set({
        status,
        doneAt: todo.doneAt ?? new Date(),
        actualHours: actuals.actualHours ?? todo.actualHours,
        actualValueEur: actuals.actualValueEur ?? todo.actualValueEur,
        updatedAt: new Date(),
      })
      .where(eq(todos.id, id));

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
    return row;
  });
}

/** Fait de cette photo la vignette de son objet ou de sa tâche. */
export async function setCoverPhoto(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(photos).where(eq(photos.id, id)).for("update");
    if (!p) throw new DomainError("Photo introuvable");
    const owner: PhotoOwner = p.objectId ? { objectId: p.objectId } : { todoId: p.todoId! };
    await tx.update(photos).set({ isCover: false }).where(and(ownerCond(owner), eq(photos.isCover, true)));
    await tx.update(photos).set({ isCover: true }).where(eq(photos.id, id));
  });
}

/**
 * Supprime une photo. Si c'était la vignette, la plus ancienne des photos restantes
 * prend le relais. Retourne les chemins des fichiers à effacer.
 */
export async function deletePhoto(db: Db, id: string): Promise<string[]> {
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

export async function listDocuments(db: Db, objectId: string): Promise<(DocumentRow & { typeName: string })[]> {
  const rows = await db
    .select({ doc: documents, typeName: documentTypes.name })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.typeId))
    .where(eq(documents.objectId, objectId))
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
    objectId: string;
    typeId: string;
    pathname: string;
    filename: string;
    contentType: string;
    size: number;
    createdById?: string | null;
  },
): Promise<DocumentRow> {
  const obj = await getObject(db, data.objectId);
  if (!obj) throw new DomainError("Objet introuvable");
  const [t] = await db.select({ id: documentTypes.id }).from(documentTypes).where(eq(documentTypes.id, data.typeId));
  if (!t) throw new DomainError("Type de document introuvable");
  const filename = data.filename.trim().slice(0, 200) || "document";
  const [row] = await db.insert(documents).values({ ...data, filename }).returning();
  return row;
}

/** Supprime un document ; retourne le chemin du fichier à effacer. */
export async function deleteDocument(db: Db, id: string): Promise<string> {
  const [row] = await db.delete(documents).where(eq(documents.id, id)).returning({ p: documents.pathname });
  if (!row) throw new DomainError("Document introuvable");
  return row.p;
}

/** Change le type d'un document. */
export async function setDocumentType(db: Db, id: string, typeId: string): Promise<void> {
  const [t] = await db.select({ id: documentTypes.id }).from(documentTypes).where(eq(documentTypes.id, typeId));
  if (!t) throw new DomainError("Type de document introuvable");
  const [row] = await db.update(documents).set({ typeId }).where(eq(documents.id, id)).returning({ id: documents.id });
  if (!row) throw new DomainError("Document introuvable");
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

export async function listLinks(db: Db, objectId: string): Promise<LinkRow[]> {
  return db.select().from(links).where(eq(links.objectId, objectId)).orderBy(asc(links.createdAt));
}

export async function addLink(
  db: Db,
  data: { objectId: string; url: string; title?: string | null; createdById?: string | null },
): Promise<LinkRow> {
  const obj = await getObject(db, data.objectId);
  if (!obj) throw new DomainError("Objet introuvable");
  const url = normalizeUrl(data.url);
  const title = (data.title ?? "").trim().slice(0, 200) || new URL(url).hostname.replace(/^www\./, "");
  const [row] = await db
    .insert(links)
    .values({ objectId: data.objectId, url, title, createdById: data.createdById ?? null })
    .returning();
  return row;
}

export async function deleteLink(db: Db, id: string): Promise<void> {
  const [row] = await db.delete(links).where(eq(links.id, id)).returning({ id: links.id });
  if (!row) throw new DomainError("Lien introuvable");
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
