"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { STATUSES, type Todo } from "@/db/schema";
import { type ActionState, firstError, optionalNumber, readObject, readTodo, readUser, str } from "@/lib/forms";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from "@/lib/document-types";
import {
  addDocument,
  addLink,
  addPhoto,
  addSubtask,
  createObject,
  createObjects,
  createTodo,
  createTodos,
  createUser,
  deleteDocument,
  deleteLink,
  deleteObject,
  deletePhoto,
  deleteSubtask,
  deleteTodo,
  DomainError,
  getTodo,
  moveObject,
  reorderSubtasks,
  searchObjects,
  type ObjectSearchHit,
  createType,
  deleteType,
  renameType,
  setCoverPhoto,
  setDocumentType,
  type TypeKind,
  setTodoStatus,
  updateObject,
  updateSubtask,
  updateTodo,
  updateUser,
} from "@/lib/repo";
import { actorOf } from "@/lib/audit";
import { requireAdmin, requireUser } from "@/lib/session";
import { exists, parseDocumentPath, parsePhotoPath, remove } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertId = (id: string) => {
  if (!UUID.test(id)) throw new DomainError("Identifiant invalide");
};

/** Auteur des actions faites depuis l'interface (pour le journal). */
async function uiActor() {
  return actorOf(await requireUser(), "interface");
}

function handle(err: unknown): ActionState {
  if (err instanceof DomainError) return { error: err.message };
  console.error(err);
  return { error: "Une erreur est survenue. Réessaie dans un instant." };
}

/** N'accepte qu'un chemin interne comme destination de retour. */
function safeReturn(fd: FormData, fallback: string, field = "returnTo") {
  const r = str(fd, field);
  return r.startsWith("/") && !r.startsWith("//") ? r : fallback;
}

// ---------- Connexion ----------

export async function signInWithGoogle(fd: FormData) {
  await signIn("google", { redirectTo: safeReturn(fd, "/", "retour") });
}

export async function signInWithDevLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await signIn("dev-login", {
      email: str(fd, "email"),
      secret: str(fd, "secret"),
      redirectTo: safeReturn(fd, "/", "retour"),
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Adresse non autorisée ou code incorrect" };
    throw err; // redirection après succès
  }
  return {};
}

export async function signOutAction() {
  await signOut({ redirectTo: "/connexion" });
}

// ---------- Objets ----------

export async function createObjectAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const parsed = readObject(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const parentId = str(fd, "parentId") || null;
  let id: string;
  try {
    if (parentId) assertId(parentId);
    id = (await createObject(getDb(), { ...parsed.data, parentId }, actor)).id;
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function updateObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const parsed = readObject(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    assertId(id);
    await updateObject(getDb(), id, parsed.data, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function moveObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const target = str(fd, "parentId");
  try {
    assertId(id);
    const newParent = target === "" || target === "racine" ? null : target;
    if (newParent) assertId(newParent);
    await moveObject(getDb(), id, newParent, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function deleteObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const parentId = str(fd, "parentId");
  try {
    assertId(id);
    await remove(await deleteObject(getDb(), id, actor));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(parentId && UUID.test(parentId) ? `/objets/${parentId}` : "/");
}

/** Déplacement depuis l'arbre (glisser-déposer ou mode « Déplacer »). */
export async function moveObjectInlineAction(id: string, newParentId: string | null): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    if (newParentId) assertId(newParentId);
    await moveObject(getDb(), id, newParentId, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

/** Suppression depuis l'arbre, après confirmation dans l'interface. */
export async function deleteObjectInlineAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await remove(await deleteObject(getDb(), id, actor));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

/** Recherche d'objets depuis l'arbre (champ avec suggestions). */
export async function searchObjectsAction(q: string): Promise<{ hits: ObjectSearchHit[]; total: number }> {
  await requireUser();
  return searchObjects(getDb(), String(q ?? ""));
}

// ---------- Types d'objets et de documents ----------

const KINDS: TypeKind[] = ["objet", "document"];
const assertKind = (k: string): TypeKind => {
  if (!KINDS.includes(k as TypeKind)) throw new DomainError("Catégorie de type invalide");
  return k as TypeKind;
};

export async function createTypeAction(kind: TypeKind, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  try {
    await createType(getDb(), assertKind(kind), str(fd, "name"));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameTypeAction(kind: TypeKind, id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await renameType(getDb(), assertKind(kind), id, str(fd, "name"));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteTypeAction(kind: TypeKind, id: string): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await deleteType(getDb(), assertKind(kind), id);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

// ---------- Ajout en lot ----------

export type BulkResult = ActionState & { count?: number };

const CATEGORY_SET = new Set(["entretien", "travaux", "administratif"]);
const PRIORITY_SET = new Set(["haute", "moyenne", "basse"]);

/** Plusieurs objets sous un même parent (ou en racines). */
export async function createObjectsBulkAction(
  parentId: string | null,
  names: string[],
  typeId: string | null,
): Promise<BulkResult> {
  const actor = await uiActor();
  try {
    if (parentId) assertId(parentId);
    if (typeId) assertId(typeId);
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) throw new DomainError("Liste invalide");
    const created = await createObjects(getDb(), parentId, names, { typeId: typeId || null }, actor);
    revalidatePath("/", "layout");
    refresh();
    return { ok: true, count: created.length };
  } catch (err) {
    return handle(err);
  }
}

/** Plusieurs tâches sur un même objet, avec catégorie, priorité, responsable et échéance communes. */
export async function createTodosBulkAction(
  objectId: string,
  titles: string[],
  common: { category?: string; priority?: string; assigneeId?: string | null; dueDate?: string | null },
): Promise<BulkResult> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  try {
    assertId(objectId);
    if (!Array.isArray(titles) || titles.some((t) => typeof t !== "string")) throw new DomainError("Liste invalide");
    const category = CATEGORY_SET.has(common.category ?? "") ? (common.category as Todo["category"]) : "entretien";
    const priority = PRIORITY_SET.has(common.priority ?? "") ? (common.priority as Todo["priority"]) : "moyenne";
    const assigneeId = common.assigneeId && UUID.test(common.assigneeId) ? common.assigneeId : null;
    const dueDate = common.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(common.dueDate) ? common.dueDate : null;
    const created = await createTodos(getDb(), objectId, titles, {
      category,
      priority,
      assigneeId,
      dueDate,
      createdById: user.id,
    }, actor);
    revalidatePath("/", "layout");
    refresh();
    return { ok: true, count: created.length };
  } catch (err) {
    return handle(err);
  }
}

// ---------- Documents et liens ----------

/** Enregistre un document déjà envoyé dans le stockage. */
export async function addDocumentAction(input: {
  typeId: string;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
}): Promise<ActionState> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  try {
    const parsed = parseDocumentPath(input.pathname);
    if (!parsed) throw new DomainError("Document invalide");
    assertId(input.typeId);
    if (!DOCUMENT_TYPES[input.contentType]) throw new DomainError("Ce type de fichier n'est pas accepté");
    if (!Number.isInteger(input.size) || input.size <= 0 || input.size > DOCUMENT_MAX_BYTES) {
      throw new DomainError("Taille de fichier invalide");
    }
    if (!(await exists(input.pathname))) throw new DomainError("L'envoi du document n'est pas terminé. Réessaie.");
    await addDocument(getDb(), {
      owner: parsed.owner,
      typeId: input.typeId,
      pathname: input.pathname,
      filename: String(input.filename ?? ""),
      contentType: input.contentType,
      size: input.size,
      createdById: user.id,
    }, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function setDocumentTypeAction(id: string, typeId: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    assertId(typeId);
    await setDocumentType(getDb(), id, typeId, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function deleteDocumentAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await remove([await deleteDocument(getDb(), id, actor)]);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function addLinkAction(
  owner: { kind: "objets" | "taches"; id: string },
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  try {
    assertId(owner.id);
    await addLink(getDb(), {
      owner: owner.kind === "taches" ? { todoId: owner.id } : { objectId: owner.id },
      url: str(fd, "url"),
      title: str(fd, "title"),
      createdById: user.id,
    }, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteLinkAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await deleteLink(getDb(), id, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

// ---------- Sous-tâches ----------

export async function addSubtaskAction(todoId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(todoId);
    await addSubtask(getDb(), todoId, str(fd, "title"), actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSubtaskAction(id: string, data: { title?: string; done?: boolean }): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await updateSubtask(getDb(), id, {
      title: typeof data.title === "string" ? data.title : undefined,
      done: typeof data.done === "boolean" ? data.done : undefined,
    }, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function deleteSubtaskAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await deleteSubtask(getDb(), id, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

/** Nouvel ordre des sous-tâches (glisser-déposer ou flèches). */
export async function reorderSubtasksAction(todoId: string, orderedIds: string[]): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(todoId);
    if (!Array.isArray(orderedIds)) throw new DomainError("Ordre invalide");
    orderedIds.forEach(assertId);
    await reorderSubtasks(getDb(), todoId, orderedIds, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

// ---------- Photos ----------

/** Enregistre une photo déjà envoyée dans le stockage (image + vignette). */
export async function addPhotoAction(input: {
  pathname: string;
  thumbPathname: string;
  width: number;
  height: number;
}): Promise<ActionState> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  try {
    const main = parsePhotoPath(input.pathname);
    const thumb = parsePhotoPath(input.thumbPathname);
    if (
      !main ||
      !thumb ||
      main.thumb ||
      !thumb.thumb ||
      main.kind !== thumb.kind ||
      main.ownerId !== thumb.ownerId ||
      main.fileId !== thumb.fileId
    ) {
      throw new DomainError("Photo invalide");
    }
    if (!(await exists(input.pathname)) || !(await exists(input.thumbPathname))) {
      throw new DomainError("L'envoi de la photo n'est pas terminé. Réessaie.");
    }
    const dims = (n: number) => (Number.isInteger(n) && n > 0 && n < 20000 ? n : null);
    await addPhoto(getDb(), main.kind === "objets" ? { objectId: main.ownerId } : { todoId: main.ownerId }, {
      pathname: input.pathname,
      thumbPathname: input.thumbPathname,
      width: dims(input.width),
      height: dims(input.height),
      createdById: user.id,
    }, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function setCoverPhotoAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await setCoverPhoto(getDb(), id, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function deletePhotoAction(id: string): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await remove(await deletePhoto(getDb(), id, actor));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

// ---------- Tâches ----------

export async function createTodoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  const parsed = readTodo(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    const data = parsed.data;
    await createTodo(getDb(), {
      ...data,
      status: data.status,
      doneAt: data.status === "fait" ? new Date() : null,
      createdById: user.id,
    }, actor);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd, `/objets/${parsed.data.objectId}`));
}

export async function updateTodoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const parsed = readTodo(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    assertId(id);
    const db = getDb();
    const before = await getTodo(db, id);
    if (!before) throw new DomainError("Tâche introuvable");
    const { status, ...rest } = parsed.data;
    await updateTodo(db, id, rest, actor);
    if (status !== before.status) {
      await setTodoStatus(db, id, status, { actualHours: rest.actualHours, actualValueEur: rest.actualValueEur, actor });
    }
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd, `/objets/${parsed.data.objectId}`));
}

/** Changement rapide de statut depuis une liste. */
export async function setStatusAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  const status = str(fd, "status") as Todo["status"];
  if (!STATUSES.includes(status)) return { error: "Statut invalide" };
  const actualHours = optionalNumber(fd, "actualHours");
  const actualValueEur = optionalNumber(fd, "actualValueEur");
  for (const n of [actualHours, actualValueEur]) {
    if (n != null && (!Number.isFinite(n) || n < 0)) return { error: "Valeur réalisée invalide" };
  }
  try {
    assertId(id);
    await setTodoStatus(getDb(), id, status, { actualHours, actualValueEur, actor });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Changement de statut depuis le tableau (glisser-déposer).
 * Passée à « fait » sans saisie, la tâche reprend ses estimations comme valeurs réalisées.
 */
export async function setStatusInlineAction(id: string, status: Todo["status"]): Promise<ActionState> {
  const actor = await uiActor();
  if (!STATUSES.includes(status)) return { error: "Statut invalide" };
  try {
    assertId(id);
    const db = getDb();
    const todo = await getTodo(db, id);
    if (!todo) throw new DomainError("Tâche introuvable");
    await setTodoStatus(db, id, status, {
      actualHours: todo.actualHours ?? todo.estHours,
      actualValueEur: todo.actualValueEur ?? todo.estValueEur,
      actor,
    });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function deleteTodoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await uiActor();
  try {
    assertId(id);
    await remove(await deleteTodo(getDb(), id, actor));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd, "/taches"));
}

// ---------- Utilisateurs (administrateurs) ----------

export async function createUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = readUser(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    await createUser(getDb(), parsed.data);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs");
  return { ok: true };
}

export async function updateUserAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = readUser(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    assertId(id);
    const { email: _email, ...rest } = parsed.data;
    void _email; // l'adresse ne change pas : c'est l'identifiant de connexion
    await updateUser(getDb(), id, { ...rest, active: str(fd, "active") === "on" });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs");
  return { ok: true };
}
