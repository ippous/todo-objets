import "server-only";
// Aides IA sur une tâche : compléter la description, proposer des sous-tâches
// et des tâches voisines. Les réponses sont toujours nettoyées et bornées ici.
import type { Db } from "@/db";
import { aiComplete, AiError, parseJsonReply, resolveProvider, type AiProvider } from "./ai";
import { getObject, getTodo, listObjects, listSubtasks, listTodos, listTypes, SUBTASK_MAX_LENGTH } from "./repo";
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
      "Ne recopie pas la liste des sous-tâches telle quelle. Conserve tels quels les éléments [image] (ne les mentionne pas) " +
      "et les textes commençant par @@. Reste bref : 80 à 250 mots.\n" +
      "Réponds uniquement avec le HTML de la description, sans bloc de code, en n'utilisant que ces balises : " +
      "<p>, <h3>, <ul>, <ol>, <li>, <strong>, <em>.",
    maxTokens: 2000,
  });
  const cleaned = reply.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  let html = sanitizeRichText(cleaned);
  if (!html) throw new AiError("L'assistant IA n'a pas proposé de description");
  const kept = keepSpecialNodes(draft.description, html);
  if (kept) html = `${html}${kept}`;
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

// ---------- Objets ----------

/** Contexte lisible d'un objet : chemin, type, emplacement, sous-objets et tâches ouvertes. */
async function objectContext(db: Db, objectId: string, draft: Draft) {
  const obj = await getObject(db, objectId);
  if (!obj) throw new AiError("Objet introuvable");
  const [objs, todos] = await Promise.all([listObjects(db), listTodos(db, { subtreeOf: objectId, statuses: ["a_faire", "en_cours"] })]);
  const chemin = pathTo(objs, objectId)
    .map((o) => o.name)
    .join(" › ");
  const children = objs.filter((o) => o.parentId === objectId).map((o) => o.name);
  const name = draft.title.trim() || obj.name;
  const description = richTextToPlain(sanitizeRichText(draft.description)).trim();
  const lines = [
    `Objet : ${name}`,
    `Chemin : ${chemin}`,
    obj.type ? `Type : ${obj.type}` : null,
    obj.location ? `Emplacement : ${obj.location}` : null,
    obj.tags.length ? `Tags : ${obj.tags.join(", ")}` : null,
    children.length ? `Sous-objets : ${children.join(", ")}` : null,
    `Description actuelle :\n${description || "(vide)"}`,
    todos.length
      ? `Tâches déjà ouvertes (sur l'objet et ses sous-objets) :\n${todos
          .slice(0, 60)
          .map((t) => `- ${t.title}${t.objectId !== objectId ? ` (${t.objectName})` : ""}`)
          .join("\n")}`
      : "Tâches déjà ouvertes : aucune",
  ];
  return { obj, name, todos, text: lines.filter(Boolean).join("\n\n") };
}

/** Description d'objet créée ou mise à niveau, en HTML limité aux balises de l'éditeur. */
export async function completeObjectDescription(
  db: Db,
  objectId: string,
  draft: Draft,
  provider?: AiProvider | null,
): Promise<{ html: string; provider: AiProvider }> {
  const ctx = await objectContext(db, objectId, draft);
  const target = await resolveProvider(db, provider);
  const reply = await aiComplete(target, {
    system: SYSTEM,
    prompt:
      `${ctx.text}\n\n---\n` +
      "Rédige ou mets à niveau la fiche descriptive de cet objet, comme un carnet d'entretien : garde toutes les informations " +
      "de la description actuelle (tu peux la reformuler et la réorganiser), et structure-la avec de courtes sections utiles " +
      "selon l'objet (caractéristiques, état, points de vigilance, entretien courant et fréquence). " +
      "Les points à vérifier peuvent être une liste de cases à cocher. N'invente pas de mesures, marques ou dates. " +
      "Conserve tels quels les éléments [image] (ne les mentionne pas) et les textes commençant par @@. 120 à 350 mots.\n" +
      "Réponds uniquement avec le HTML, sans bloc de code, en n'utilisant que : <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, " +
      'et pour une liste à cocher : <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>…</p></li></ul>.',
    maxTokens: 3000,
  });
  const cleaned = reply.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  let html = sanitizeRichText(cleaned);
  if (!html) throw new AiError("L'assistant IA n'a pas proposé de description");
  // Les images et commandes @@ de la description d'origine sont remises à la fin si l'IA les a perdues
  const kept = keepSpecialNodes(draft.description, html);
  if (kept) html = `${html}${kept}`;
  return { html, provider: target.provider };
}

/** Images et commandes @@ du brouillon absentes de la proposition, à recoller. */
function keepSpecialNodes(original: string | null, proposal: string): string {
  const src = sanitizeRichText(original) ?? "";
  const lost = [
    ...[...src.matchAll(/<img [^>]*data-photo="([0-9a-f-]+)"[^>]*\/?>/g)].filter((m) => !proposal.includes(m[1])).map((m) => m[0]),
    ...[...src.matchAll(/<span data-commande="([a-z0-9_-]+)">[^<]*<\/span>/g)]
      .filter((m) => !proposal.includes(`data-commande="${m[1]}"`))
      .map((m) => m[0]),
  ];
  return lost.length ? `<p>${lost.join(" ")}</p>` : "";
}

/** Tâches proposées pour un objet, sans doublon avec les tâches ouvertes. */
export async function proposeObjectTasks(
  db: Db,
  objectId: string,
  draft: Draft,
  provider?: AiProvider | null,
): Promise<{ tasks: TaskProposal[]; provider: AiProvider }> {
  const ctx = await objectContext(db, objectId, draft);
  const target = await resolveProvider(db, provider);
  const reply = await aiComplete(target, {
    system: SYSTEM,
    prompt:
      `${ctx.text}\n\n---\n` +
      "Propose 3 à 8 tâches utiles pour cet objet (entretien, réparations, vérifications, démarches), sans reprendre les tâches déjà ouvertes. " +
      "Appuie-toi d'abord sur la description (cases non cochées, problèmes signalés). Titre court commençant par un verbe à l'infinitif, " +
      "une phrase de description, durée estimée en heures si c'est raisonnable.\n" +
      "Réponds uniquement avec un objet JSON, sans texte autour :\n" +
      '{"taches":[{"titre":"…","description":"…","heures":1}]}',
    maxTokens: 2000,
  });
  const data = parseJsonReply<{ taches?: unknown }>(reply);
  const seen = new Set(ctx.todos.map((t) => norm(t.title)));
  const tasks: TaskProposal[] = [];
  for (const raw of Array.isArray(data.taches) ? data.taches : []) {
    const r = (typeof raw === "string" ? { titre: raw } : raw) as Record<string, unknown>;
    const title = clean(r?.titre ?? r?.title, 200);
    if (!title || seen.has(norm(title))) continue;
    seen.add(norm(title));
    tasks.push({ title, description: clean(r?.description, 500) || null, estHours: hours(r?.heures ?? r?.hours) });
    if (tasks.length >= 10) break;
  }
  if (!tasks.length) throw new AiError("L'assistant IA n'a proposé aucune tâche nouvelle");
  return { tasks, provider: target.provider };
}
