import "server-only";
// Outils MCP d'ÉCRITURE (accès « lecture ecriture » uniquement).
// Aucune suppression : créer / modifier des tâches, créer / modifier / déplacer des objets, ajouter des liens.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db";
import { CATEGORIES, PRIORITIES, RECURRENCES, STATUSES, type NewTodo, type User } from "@/db/schema";
import {
  addLink,
  createObject,
  createTodo,
  DomainError,
  getObject,
  getTodo,
  listTypes,
  listUsers,
  moveObject,
  setTodoStatus,
  updateObject,
  updateTodo,
} from "./repo";
import { markdownToRichText } from "./rich-text";

const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ");
const AMOUNT = z.number().min(0).max(1e9);
const DESCRIPTION = z
  .string()
  .max(40_000)
  .describe("Texte en Markdown simple : ## titres, - listes, 1. listes, **gras**, *italique*, [lien](https://…), > citation");
const TAGS = z.array(z.string().min(1).max(40)).max(20);

type Ctx = { db: Db; user: User; objectUrl: (id: string) => string; todoUrl: (id: string) => string };

function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
/** Erreurs métier renvoyées à l'assistant (lisibles), les autres remontent. */
async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) return fail(err.message);
    throw err;
  }
}

/** Date du jour à Paris (pour la récurrence). */
const parisToday = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

export function registerWriteTools(server: McpServer, { db, user, objectUrl, todoUrl }: Ctx) {
  async function resolveAssignee(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim().toLowerCase() === "personne" || raw.trim() === "") return null;
    const r = raw.trim().toLowerCase();
    if (r === "moi") return user.id;
    const who = (await listUsers(db)).find((u) => u.active && (u.email.toLowerCase() === r || u.name.toLowerCase() === r));
    if (!who) throw new DomainError(`Responsable « ${raw} » inconnu. Utilise vue_ensemble pour la liste des utilisateurs.`);
    return who.id;
  }

  async function resolveObjectType(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim() === "") return null;
    const types = await listTypes(db, "objet");
    const t = types.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!t) {
      throw new DomainError(
        `Type d'objet « ${raw} » inconnu. Types existants : ${types.map((x) => x.name).join(", ")}. (Un nouveau type se crée dans Carnet, page Types.)`,
      );
    }
    return t.id;
  }

  // ---------- creer_tache ----------
  server.registerTool(
    "creer_tache",
    {
      title: "Créer une tâche",
      description: "Crée une tâche rattachée à un objet. Seuls l'objet et le titre sont obligatoires.",
      inputSchema: {
        objet_id: UUID.describe("Objet auquel rattacher la tâche (voir lister_objets)"),
        titre: z.string().min(1).max(200),
        description: DESCRIPTION.optional(),
        statut: z.enum(STATUSES).default("a_faire"),
        priorite: z.enum(PRIORITIES).default("moyenne"),
        categorie: z.enum(CATEGORIES).default("entretien"),
        echeance: DATE.optional(),
        recurrence: z.enum(RECURRENCES).default("aucune"),
        responsable: z.string().max(100).optional().describe("Nom ou e-mail d'un utilisateur, « moi » ou « personne »"),
        heures_estimees: AMOUNT.optional(),
        valeur_estimee_eur: AMOUNT.optional(),
        tags: TAGS.optional(),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        const data: NewTodo = {
          objectId: a.objet_id,
          title: a.titre.trim(),
          description: markdownToRichText(a.description),
          status: a.statut === "fait" ? "a_faire" : a.statut,
          priority: a.priorite,
          category: a.categorie,
          dueDate: a.echeance ?? null,
          recurrence: a.recurrence,
          assigneeId: (await resolveAssignee(a.responsable)) ?? null,
          estHours: a.heures_estimees ?? null,
          estValueEur: a.valeur_estimee_eur ?? null,
          tags: cleanTags(a.tags ?? []),
          createdById: user.id,
        };
        const t = await createTodo(db, data);
        if (a.statut === "fait") await setTodoStatus(db, t.id, "fait", {}, parisToday());
        const obj = await getObject(db, t.objectId);
        return ok({ cree: true, id: t.id, titre: t.title, objet: obj?.name, url: todoUrl(t.id) });
      }),
  );

  // ---------- modifier_tache ----------
  server.registerTool(
    "modifier_tache",
    {
      title: "Modifier une tâche",
      description:
        "Modifie une tâche : seuls les champs fournis changent ; null efface un champ facultatif. " +
        "statut « fait » enregistre la fin (et crée l'occurrence suivante si la tâche est récurrente). " +
        "objet_id rattache la tâche à un autre objet.",
      inputSchema: {
        id: UUID.describe("Identifiant de la tâche"),
        titre: z.string().min(1).max(200).optional(),
        objet_id: UUID.optional(),
        description: DESCRIPTION.nullable().optional(),
        statut: z.enum(STATUSES).optional(),
        priorite: z.enum(PRIORITIES).optional(),
        categorie: z.enum(CATEGORIES).optional(),
        echeance: DATE.nullable().optional(),
        recurrence: z.enum(RECURRENCES).optional(),
        responsable: z.string().max(100).nullable().optional().describe("Nom, e-mail, « moi », ou null / « personne » pour retirer"),
        heures_estimees: AMOUNT.nullable().optional(),
        valeur_estimee_eur: AMOUNT.nullable().optional(),
        heures_realisees: AMOUNT.nullable().optional(),
        valeur_realisee_eur: AMOUNT.nullable().optional(),
        tags: TAGS.optional().describe("Remplace la liste des tags"),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        const before = await getTodo(db, a.id);
        if (!before) return fail(`Tâche ${a.id} introuvable`);
        const data: Partial<NewTodo> = {};
        if (a.titre !== undefined) data.title = a.titre.trim();
        if (a.objet_id !== undefined) data.objectId = a.objet_id;
        if (a.description !== undefined) data.description = markdownToRichText(a.description);
        if (a.priorite !== undefined) data.priority = a.priorite;
        if (a.categorie !== undefined) data.category = a.categorie;
        if (a.echeance !== undefined) data.dueDate = a.echeance;
        if (a.recurrence !== undefined) data.recurrence = a.recurrence;
        const assignee = await resolveAssignee(a.responsable);
        if (assignee !== undefined) data.assigneeId = assignee;
        if (a.heures_estimees !== undefined) data.estHours = a.heures_estimees;
        if (a.valeur_estimee_eur !== undefined) data.estValueEur = a.valeur_estimee_eur;
        if (a.heures_realisees !== undefined) data.actualHours = a.heures_realisees;
        if (a.valeur_realisee_eur !== undefined) data.actualValueEur = a.valeur_realisee_eur;
        if (a.tags !== undefined) data.tags = cleanTags(a.tags);
        if (Object.keys(data).length) await updateTodo(db, a.id, data);
        let suivante: string | null = null;
        if (a.statut !== undefined && a.statut !== before.status) suivante = await setTodoStatus(db, a.id, a.statut, {}, parisToday());
        const after = (await getTodo(db, a.id))!;
        return ok({
          modifie: true,
          id: after.id,
          titre: after.title,
          statut: after.status,
          champs_modifies: [...Object.keys(a).filter((k) => k !== "id")],
          occurrence_suivante: suivante ? { id: suivante, url: todoUrl(suivante) } : null,
          url: todoUrl(after.id),
        });
      }),
  );

  // ---------- creer_objet ----------
  server.registerTool(
    "creer_objet",
    {
      title: "Créer un objet",
      description: "Crée un objet dans l'arbre, sous un parent (ou comme nouvelle racine si parent_id est absent).",
      inputSchema: {
        nom: z.string().min(1).max(120),
        parent_id: UUID.optional().describe("Objet parent ; absent = nouvel arbre racine"),
        type: z.string().max(60).optional().describe("Nom d'un type d'objet existant (voir vue_ensemble)"),
        description: DESCRIPTION.optional(),
        emplacement: z.string().max(200).optional(),
        tags: TAGS.optional(),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        const o = await createObject(db, {
          name: a.nom.trim(),
          parentId: a.parent_id ?? null,
          typeId: (await resolveObjectType(a.type)) ?? null,
          description: markdownToRichText(a.description),
          location: a.emplacement?.trim() || null,
          tags: cleanTags(a.tags ?? []),
        });
        return ok({ cree: true, id: o.id, nom: o.name, url: objectUrl(o.id) });
      }),
  );

  // ---------- modifier_objet ----------
  server.registerTool(
    "modifier_objet",
    {
      title: "Modifier un objet",
      description: "Modifie le nom, le type, la description, l'emplacement ou les tags d'un objet ; null efface un champ facultatif. Pour changer de parent : deplacer_objet.",
      inputSchema: {
        id: UUID.describe("Identifiant de l'objet"),
        nom: z.string().min(1).max(120).optional(),
        type: z.string().max(60).nullable().optional(),
        description: DESCRIPTION.nullable().optional(),
        emplacement: z.string().max(200).nullable().optional(),
        tags: TAGS.optional().describe("Remplace la liste des tags"),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        const o = await getObject(db, a.id);
        if (!o) return fail(`Objet ${a.id} introuvable`);
        const typeId = await resolveObjectType(a.type);
        await updateObject(db, a.id, {
          name: a.nom?.trim() ?? o.name,
          typeId: typeId === undefined ? o.typeId : typeId,
          description: a.description === undefined ? o.description : markdownToRichText(a.description),
          location: a.emplacement === undefined ? o.location : a.emplacement?.trim() || null,
          tags: a.tags === undefined ? o.tags : cleanTags(a.tags),
        });
        return ok({ modifie: true, id: a.id, nom: a.nom ?? o.name, champs_modifies: Object.keys(a).filter((k) => k !== "id"), url: objectUrl(a.id) });
      }),
  );

  // ---------- deplacer_objet ----------
  server.registerTool(
    "deplacer_objet",
    {
      title: "Déplacer un objet",
      description: "Déplace un objet (avec tout son sous-arbre, ses tâches, photos et documents) sous un autre parent, ou à la racine si nouveau_parent_id est null. Les boucles sont refusées.",
      inputSchema: {
        id: UUID.describe("Objet à déplacer"),
        nouveau_parent_id: UUID.nullable().describe("Nouveau parent, ou null pour en faire une racine"),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        await moveObject(db, a.id, a.nouveau_parent_id);
        const [o, p] = await Promise.all([getObject(db, a.id), a.nouveau_parent_id ? getObject(db, a.nouveau_parent_id) : undefined]);
        return ok({ deplace: true, id: a.id, nom: o?.name, nouveau_parent: p?.name ?? "(racine)", url: objectUrl(a.id) });
      }),
  );

  // ---------- ajouter_lien ----------
  server.registerTool(
    "ajouter_lien",
    {
      title: "Ajouter un lien",
      description: "Ajoute un lien web (http/https) à un objet OU à une tâche (fournir exactement l'un des deux).",
      inputSchema: {
        objet_id: UUID.optional(),
        tache_id: UUID.optional(),
        url: z.string().min(3).max(2000),
        titre: z.string().max(200).optional(),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        if (!!a.objet_id === !!a.tache_id) return fail("Fournis soit objet_id, soit tache_id (un seul des deux).");
        const owner = a.objet_id ? { objectId: a.objet_id } : { todoId: a.tache_id! };
        const l = await addLink(db, { owner, url: a.url, title: a.titre, createdById: user.id });
        return ok({
          ajoute: true,
          titre: l.title,
          url_lien: l.url,
          page: a.objet_id ? objectUrl(a.objet_id) : todoUrl(a.tache_id!),
        });
      }),
  );
}
