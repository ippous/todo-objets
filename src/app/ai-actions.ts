"use server";

import { refresh, revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { AI_PROVIDERS, AiError, saveAiProvider, setDefaultAiProvider, type AiProvider } from "@/lib/ai";
import { actorOf } from "@/lib/audit";
import type { ActionState } from "@/lib/forms";
import { addSubtask, createTodo, DomainError, getTodo } from "@/lib/repo";
import { sanitizeRichText } from "@/lib/rich-text";
import { requireAdmin, requireUser } from "@/lib/session";
import {
  completeDescription,
  proposeSubtasks,
  type SubtaskProposal,
  type TaskProposal,
} from "@/lib/task-assistant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(err: unknown): { error: string } {
  if (err instanceof AiError || err instanceof DomainError) return { error: err.message };
  console.error(err);
  return { error: "Une erreur est survenue. Réessaie dans un instant." };
}

const asProvider = (p: unknown): AiProvider | null =>
  typeof p === "string" && (AI_PROVIDERS as readonly string[]).includes(p) ? (p as AiProvider) : null;

/** Titre et description en cours de saisie (pas forcément enregistrés). */
type Draft = { title: string; description: string | null };
const asDraft = (d: unknown): Draft => {
  const o = (d ?? {}) as Record<string, unknown>;
  return {
    title: typeof o.title === "string" ? o.title.slice(0, 200) : "",
    description: typeof o.description === "string" ? o.description.slice(0, 50_000) : null,
  };
};

// ---------- Réglages (administrateurs) ----------

export async function saveAiProviderAction(provider: AiProvider, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const p = asProvider(provider);
    if (!p) throw new AiError("Fournisseur inconnu");
    const key = String(fd.get("apiKey") ?? "");
    const remove = fd.get("removeKey") === "1";
    await saveAiProvider(getDb(), p, {
      model: String(fd.get("model") ?? ""),
      // Champ vide : on garde la clé déjà enregistrée
      apiKey: remove ? "" : key.trim() ? key : undefined,
      makeDefault: fd.get("makeDefault") === "on",
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setDefaultAiProviderAction(provider: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const p = asProvider(provider);
    if (!p) throw new AiError("Fournisseur inconnu");
    await setDefaultAiProvider(getDb(), p);
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/", "layout");
  refresh();
  return { ok: true };
}

// ---------- Aides sur une tâche ----------

export async function aiCompleteDescriptionAction(
  todoId: string,
  draft: Draft,
  provider: string | null,
): Promise<{ html?: string; error?: string }> {
  await requireUser();
  try {
    if (!UUID.test(todoId)) throw new DomainError("Identifiant invalide");
    const r = await completeDescription(getDb(), todoId, asDraft(draft), asProvider(provider));
    return { html: r.html };
  } catch (err) {
    return fail(err);
  }
}

export async function aiProposeAction(
  todoId: string,
  draft: Draft,
  provider: string | null,
): Promise<{ subtasks?: SubtaskProposal[]; tasks?: TaskProposal[]; error?: string }> {
  await requireUser();
  try {
    if (!UUID.test(todoId)) throw new DomainError("Identifiant invalide");
    const r = await proposeSubtasks(getDb(), todoId, asDraft(draft), asProvider(provider));
    return { subtasks: r.subtasks, tasks: r.tasks };
  } catch (err) {
    return fail(err);
  }
}

const hoursOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1000 ? v : null);

/** Crée les sous-tâches et les tâches voisines retenues (sur le même objet, avec le même type). */
export async function applyAiProposalsAction(
  todoId: string,
  picked: { subtasks: SubtaskProposal[]; tasks: TaskProposal[] },
): Promise<{ subtasks?: number; tasks?: number; error?: string }> {
  const user = await requireUser();
  const actor = actorOf(user, "interface");
  try {
    if (!UUID.test(todoId)) throw new DomainError("Identifiant invalide");
    const subs = Array.isArray(picked?.subtasks) ? picked.subtasks.slice(0, 20) : [];
    const tasks = Array.isArray(picked?.tasks) ? picked.tasks.slice(0, 10) : [];
    const db = getDb();
    const todo = await getTodo(db, todoId);
    if (!todo) throw new DomainError("Tâche introuvable");
    for (const s of subs) {
      if (typeof s?.title !== "string") continue;
      await addSubtask(db, todoId, s.title, actor, { estHours: hoursOrNull(s.estHours) });
    }
    for (const t of tasks) {
      if (typeof t?.title !== "string" || !t.title.trim()) continue;
      await createTodo(
        db,
        {
          objectId: todo.objectId,
          title: t.title.trim().slice(0, 200),
          description: sanitizeRichText(typeof t.description === "string" ? t.description.slice(0, 2000) : null),
          typeId: todo.typeId,
          priority: todo.priority,
          estHours: hoursOrNull(t.estHours),
          createdById: user.id,
        },
        actor,
      );
    }
    revalidatePath("/", "layout");
    refresh();
    return { subtasks: subs.length, tasks: tasks.length };
  } catch (err) {
    return fail(err);
  }
}
