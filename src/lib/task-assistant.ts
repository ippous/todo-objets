import "server-only";
// Aides IA sur une tâche : compléter la description, proposer des sous-tâches
// et des tâches voisines. Les réponses sont toujours nettoyées et bornées ici.
import type { Db } from "@/db";
import { aiComplete, AiError, parseJsonReply, resolveProvider, type AiProvider } from "./ai";
import { getObject, getTodo, listObjects, listSubtasks, listTypes, SUBTASK_MAX_LENGTH } from "./repo";
import { richTextToPlain, sanitizeRichText } from "./rich-text";
import { pathTo } from "./tree";

type Draft = { title: string; description: string | null };

/** Contexte lisible d'une tâche, commun aux deux demandes. */
async function context(db: Db, todoId: string, draft: Draft) {
  const todo = await getTodo(db, todoId);
  if (!todo) throw new AiError("Tâche introuvable");
  const [subs, objs, types, obj] = await Promise.all([
    listSubtasks(db, todoId),
    listObjects(db),
    listTypes(db, "tache"),
    getObject(db, todo.objectId),
  ]);
  const chemin = pathTo(objs, todo.objectId)
    .map((o) => o.name)
    .join(" › ");
  const typeName = types.find((t) => t.id === todo.typeId)?.name ?? null;
  const title = draft.title.trim() || todo.title;
  const description = richTextToPlain(sanitizeRichText(draft.description)).trim();
  const lines = [
    `Tâche : ${title}`,
    `Objet concerné : ${chemin || obj?.name || "?"}${obj?.description ? ` — ${richTextToPlain(obj.description).slice(0, 600)}` : ""}`,
    typeName ? `Type : ${typeName}` : null,
    todo.dueDate ? `Échéance : ${todo.dueDate}` : null,
    `Description actuelle :\n${description || "(vide)"}`,
    subs.length
      ? `Sous-tâches existantes :\n${subs
          .map(
            (s) =>
              `- [${s.done ? "x" : " "}] ${s.title}${s.estHours != null ? ` (prévu ${s.estHours} h)` : ""}${s.actualHours != null ? ` (réalisé ${s.actualHours} h)` : ""}`,
          )
          .join("\n")}`
      : "Sous-tâches existantes : aucune",
  ];
  return { todo, subs, title, text: lines.filter(Boolean).join("\n\n") };
}

const SYSTEM =
  "Tu aides à tenir Carnet, une appli personnelle de tâches d'entretien et de travaux rattachées à des objets " +
  "(propriété, bâtiments, pièces, véhicules, terrains, animaux…). Tu écris en français, de façon concrète et pratique, " +
  "sans formules creuses. N'invente pas de faits précis (marques, prix, mesures) qui ne figurent pas dans le contexte.";

/** Description complétée, en HTML limité aux balises de l'éditeur. */
export async function completeDescription(
  db: Db,
  todoId: string,
  draft: Draft,
  provider?: AiProvider | null,
): Promise<{ html: string; provider: AiProvider }> {
  const ctx = await context(db, todoId, draft);
  const target = await resolveProvider(db, provider);
  const reply = await aiComplete(target, {
    system: SYSTEM,
    prompt:
      `${ctx.text}\n\n---\n` +
      "Complète la description de cette tâche à partir de ce qui précède : garde tout ce que dit la description actuelle " +
      "(tu peux la reformuler légèrement et la réorganiser), précise l'objectif, le matériel ou les fournitures utiles, " +
      "les points d'attention et de sécurité, et un ordre de déroulement cohérent avec les sous-tâches. " +
      "Ne recopie pas la liste des sous-tâches telle quelle. Reste bref : 80 à 250 mots.\n" +
      "Réponds uniquement avec le HTML de la description, sans bloc de code, en n'utilisant que ces balises : " +
      "<p>, <h3>, <ul>, <ol>, <li>, <strong>, <em>.",
    maxTokens: 2000,
  });
  const cleaned = reply.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  const html = sanitizeRichText(cleaned);
  if (!html) throw new AiError("L'assistant IA n'a pas proposé de description");
  return { html, provider: target.provider };
}

export type SubtaskProposal = { title: string; estHours: number | null };
export type TaskProposal = { title: string; description: string | null; estHours: number | null };

const MAX_SUBTASKS = 12;
const MAX_TASKS = 6;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const hours = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 4) / 4 : null;
};
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Sous-tâches et tâches voisines proposées, sans doublon avec l'existant. */
export async function proposeSubtasks(
  db: Db,
  todoId: string,
  draft: Draft,
  provider?: AiProvider | null,
): Promise<{ subtasks: SubtaskProposal[]; tasks: TaskProposal[]; provider: AiProvider }> {
  const ctx = await context(db, todoId, draft);
  const target = await resolveProvider(db, provider);
  const reply = await aiComplete(target, {
    system: SYSTEM,
    prompt:
      `${ctx.text}\n\n---\n` +
      "1) Découpe cette tâche en sous-tâches concrètes, dans l'ordre où on les fait (3 à 10), sans reprendre les sous-tâches existantes. " +
      "Chaque titre tient en une ligne courte, commence par un verbe à l'infinitif. Estime la durée de chacune en heures si c'est raisonnable.\n" +
      "2) Propose 0 à 4 autres tâches distinctes, liées à celle-ci sur le même objet (préparation, suite logique, entretien associé), " +
      "uniquement si elles sont vraiment utiles.\n" +
      "Réponds uniquement avec un objet JSON, sans texte autour :\n" +
      '{"sous_taches":[{"titre":"…","heures":1.5}],"taches_similaires":[{"titre":"…","description":"une phrase","heures":2}]}',
    maxTokens: 2000,
  });
  const data = parseJsonReply<{ sous_taches?: unknown; taches_similaires?: unknown }>(reply);

  const seen = new Set(ctx.subs.map((s) => norm(s.title)));
  const subtasks: SubtaskProposal[] = [];
  for (const raw of Array.isArray(data.sous_taches) ? data.sous_taches : []) {
    const r = (typeof raw === "string" ? { titre: raw } : raw) as Record<string, unknown>;
    const title = clean(r?.titre ?? r?.title, SUBTASK_MAX_LENGTH);
    if (!title || seen.has(norm(title))) continue;
    seen.add(norm(title));
    subtasks.push({ title, estHours: hours(r?.heures ?? r?.hours) });
    if (subtasks.length >= MAX_SUBTASKS) break;
  }

  const taskSeen = new Set([norm(ctx.title)]);
  const tasks: TaskProposal[] = [];
  for (const raw of Array.isArray(data.taches_similaires) ? data.taches_similaires : []) {
    const r = (typeof raw === "string" ? { titre: raw } : raw) as Record<string, unknown>;
    const title = clean(r?.titre ?? r?.title, 200);
    if (!title || taskSeen.has(norm(title))) continue;
    taskSeen.add(norm(title));
    tasks.push({ title, description: clean(r?.description, 500) || null, estHours: hours(r?.heures ?? r?.hours) });
    if (tasks.length >= MAX_TASKS) break;
  }
  if (!subtasks.length && !tasks.length) throw new AiError("L'assistant IA n'a rien proposé de nouveau");
  return { subtasks, tasks, provider: target.provider };
}
