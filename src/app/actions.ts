"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { STATUSES, type Todo } from "@/db/schema";
import { type ActionState, firstError, optionalNumber, readObject, readTodo, readUser, str } from "@/lib/forms";
import {
  createObject,
  createTodo,
  createUser,
  deleteObject,
  deleteTodo,
  DomainError,
  getTodo,
  moveObject,
  setTodoStatus,
  updateObject,
  updateTodo,
  updateUser,
} from "@/lib/repo";
import { requireAdmin, requireUser } from "@/lib/session";

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
    await deleteObject(getDb(), id);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/", "layout");
  redirect(parentId && UUID.test(parentId) ? `/objets/${parentId}` : "/");
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
    await deleteTodo(getDb(), id);
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
