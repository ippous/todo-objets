"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { STATUSES, type Todo } from "@/db/schema";
import { type ActionState, firstError, optionalNumber, readObject, readTodo, readUser, str } from "@/lib/forms";
import {
  addPhoto,
  createObject,
  createObjects,
  createTodo,
  createTodos,
  createUser,
  deleteObject,
  deletePhoto,
  deleteTodo,
  DomainError,
  getTodo,
  moveObject,
  setCoverPhoto,
  setTodoStatus,
  updateObject,
  updateTodo,
  updateUser,
} from "@/lib/repo";
import { requireAdmin, requireUser } from "@/lib/session";
import { exists, parsePhotoPath, remove } from "@/lib/storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertId = (id: string) => {
  if (!UUID.test(id)) throw new DomainError("Identifiant invalide");
};

function handle(err: unknown): ActionState {
  if (err instanceof DomainError) return { error: err.message };
  console.error(err);
  return { error: "Une erreur est survenue. Réessaie dans un instant." };
}

/** N'accepte qu'un chemin interne comme destination de retour. */
function safeReturn(fd: FormData, fallback: string) {
  const r = str(fd, "returnTo");
  return r.startsWith("/") && !r.startsWith("//") ? r : fallback;
}

// ---------- Connexion ----------

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signInWithDevLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await signIn("dev-login", { email: str(fd, "email"), secret: str(fd, "secret"), redirectTo: "/" });
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
  await requireUser();
  const parsed = readObject(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  const parentId = str(fd, "parentId") || null;
  let id: string;
  try {
    if (parentId) assertId(parentId);
    id = (await createObject(getDb(), { ...parsed.data, parentId })).id;
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function updateObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = readObject(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    assertId(id);
    await updateObject(getDb(), id, parsed.data);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function moveObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const target = str(fd, "parentId");
  try {
    assertId(id);
    const newParent = target === "" || target === "racine" ? null : target;
    if (newParent) assertId(newParent);
    await moveObject(getDb(), id, newParent);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(`/objets/${id}`);
}

export async function deleteObjectAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parentId = str(fd, "parentId");
  try {
    assertId(id);
    await remove(await deleteObject(getDb(), id));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(parentId && UUID.test(parentId) ? `/objets/${parentId}` : "/");
}

/** Déplacement depuis l'arbre (glisser-déposer ou mode « Déplacer »). */
export async function moveObjectInlineAction(id: string, newParentId: string | null): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    if (newParentId) assertId(newParentId);
    await moveObject(getDb(), id, newParentId);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

/** Suppression depuis l'arbre, après confirmation dans l'interface. */
export async function deleteObjectInlineAction(id: string): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await remove(await deleteObject(getDb(), id));
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
  type: string | null,
): Promise<BulkResult> {
  await requireUser();
  try {
    if (parentId) assertId(parentId);
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) throw new DomainError("Liste invalide");
    const created = await createObjects(getDb(), parentId, names, { type: type?.trim().slice(0, 60) || null });
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
    });
    revalidatePath("/", "layout");
    refresh();
    return { ok: true, count: created.length };
  } catch (err) {
    return handle(err);
  }
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
    });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function setCoverPhotoAction(id: string): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await setCoverPhoto(getDb(), id);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

export async function deletePhotoAction(id: string): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await remove(await deletePhoto(getDb(), id));
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
  const parsed = readTodo(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    const data = parsed.data;
    await createTodo(getDb(), {
      ...data,
      status: data.status,
      doneAt: data.status === "fait" ? new Date() : null,
      createdById: user.id,
    });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd, `/objets/${parsed.data.objectId}`));
}

export async function updateTodoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = readTodo(fd);
  if (!parsed.success) return { error: firstError(parsed.error) };
  try {
    assertId(id);
    const db = getDb();
    const before = await getTodo(db, id);
    if (!before) throw new DomainError("Tâche introuvable");
    const { status, ...rest } = parsed.data;
    await updateTodo(db, id, rest);
    if (status !== before.status) {
      await setTodoStatus(db, id, status, { actualHours: rest.actualHours, actualValueEur: rest.actualValueEur });
    }
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(safeReturn(fd, `/objets/${parsed.data.objectId}`));
}

/** Changement rapide de statut depuis une liste. */
export async function setStatusAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const status = str(fd, "status") as Todo["status"];
  if (!STATUSES.includes(status)) return { error: "Statut invalide" };
  const actualHours = optionalNumber(fd, "actualHours");
  const actualValueEur = optionalNumber(fd, "actualValueEur");
  for (const n of [actualHours, actualValueEur]) {
    if (n != null && (!Number.isFinite(n) || n < 0)) return { error: "Valeur réalisée invalide" };
  }
  try {
    assertId(id);
    await setTodoStatus(getDb(), id, status, { actualHours, actualValueEur });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteTodoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  try {
    assertId(id);
    await remove(await deleteTodo(getDb(), id));
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
