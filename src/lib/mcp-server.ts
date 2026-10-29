import "server-only";
// Serveur MCP de Carnet : outils de lecture, et outils d'écriture si l'accès le permet (sans suppression).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db";
import { CATEGORIES, PRIORITIES, STATUSES, type ObjectRow, type User } from "@/db/schema";
import {
  getObject,
  getTodo,
  listDocuments,
  listLinks,
  listObjects,
  listPhotos,
  listSubtasks,
  listTodos,
  listTypes,
  listUsers,
  openStatsByObject,
  type TodoFilters,
  type TodoListItem,
  type TodoSort,
} from "./repo";
import { describeDetails, listAudit } from "./audit";
import { registerWriteTools } from "./mcp-write-tools";
import { richTextToPlain } from "./rich-text";
import { buildForest, flatten, pathTo, subtreeIds, type TreeNode } from "./tree";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const STATUS_LABEL: Record<string, string> = { a_faire: "à faire", en_cours: "en cours", fait: "fait" };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: (Array.isArray(data) ? { resultats: data } : data) as Record<string, unknown>,
  };
}
function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const UUID = z.string().uuid();

export function buildMcpServer(db: Db, user: User, origin: string, write = false, client: string | null = null): McpServer {
  const server = new McpServer(
    { name: "carnet", title: "Carnet — objets et tâches", version: "1.0.0" },
    {
      instructions:
        "Carnet gère des tâches rattachées à des objets classés en arbres (propriété › bâtiment › pièce, véhicule, projet…). " +
        (write
          ? "Cet accès permet de lire ET de modifier (créer/modifier des tâches, créer/modifier/déplacer des objets, ajouter des liens ; aucune suppression). Vérifie l'objet ou la tâche avant de modifier. "
          : "Accès en lecture seule. ") +
        "Commence par `vue_ensemble`, puis `lister_objets` pour l'arbre, `rechercher_taches` pour les tâches, " +
        "et `obtenir_objet` / `obtenir_tache` pour le détail (description, documents, liens). Les montants sont en euros, les durées en heures, " +
        "les dates au format AAAA-MM-JJ (fuseau Europe/Paris). Chaque résultat contient une `url` vers la page Carnet correspondante.",
    },
  );

  const objectUrl = (id: string) => `${origin}/objets/${id}`;
  const todoUrl = (id: string) => `${origin}/taches/${id}`;
  const docUrl = (id: string) => `${origin}/documents/${id}`;
  const chemin = (objs: ObjectRow[], id: string) =>
    pathTo(objs, id)
      .map((o) => o.name)
      .join(" › ");

  async function forest() {
    const [objs, stats] = await Promise.all([listObjects(db), openStatsByObject(db)]);
    const nodes = flatten(buildForest(objs, stats));
    return { objs, nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
  }

  const todoSummary = (objs: ObjectRow[], t: TodoListItem) => ({
    id: t.id,
    titre: t.title,
    statut: STATUS_LABEL[t.status],
    priorite: t.priority,
    categorie: t.category,
    echeance: t.dueDate,
    en_retard: t.status !== "fait" && !!t.dueDate && t.dueDate < today(),
    recurrence: t.recurrence,
    objet: { id: t.objectId, nom: t.objectName, chemin: chemin(objs, t.objectId) },
    responsable: t.assigneeName,
    heures_estimees: t.estHours,
    valeur_estimee_eur: t.estValueEur,
    heures_realisees: t.actualHours,
    valeur_realisee_eur: t.actualValueEur,
    euros_par_heure: t.valuePerHour,
    tags: t.tags,
    url: todoUrl(t.id),
  });

  // ---------- vue_ensemble ----------
  server.registerTool(
    "vue_ensemble",
    {
      title: "Vue d'ensemble",
      description:
        "Résumé de Carnet : nombre d'objets et de tâches (ouvertes, en retard, faites), arbres racines avec leurs cumuls, " +
        "types d'objets et de documents, utilisateurs (responsables possibles) et valeurs possibles des champs.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const [{ nodes }, todos, objTypes, docTypes, people] = await Promise.all([
        forest(),
        listTodos(db, {}),
        listTypes(db, "objet"),
        listTypes(db, "document"),
        listUsers(db),
      ]);
      const open = todos.filter((t) => t.status !== "fait");
      return result({
        utilisateur_connecte: user.name,
        droits: write ? "lecture et écriture" : "lecture seule",
        objets: nodes.length,
        taches: {
          ouvertes: open.length,
          en_retard: open.filter((t) => t.dueDate && t.dueDate < today()).length,
          faites: todos.length - open.length,
        },
        racines: nodes
          .filter((n) => n.depth === 0)
          .map((n) => ({
            id: n.id,
            nom: n.name,
            type: n.type,
            taches_ouvertes: n.total.openCount,
            heures_estimees: n.total.estHours,
            valeur_estimee_eur: n.total.estValueEur,
            url: objectUrl(n.id),
          })),
        types_objets: objTypes.map((t) => ({ nom: t.name, nombre: t.usage })),
        types_documents: docTypes.map((t) => ({ nom: t.name, nombre: t.usage })),
        utilisateurs: people.filter((u) => u.active).map((u) => ({ nom: u.name, role: u.role })),
        valeurs: { statuts: STATUSES, priorites: PRIORITIES, categories: CATEGORIES, recurrences: ["aucune", "mensuelle", "saisonniere", "annuelle"] },
        aujourd_hui: today(),
      });
    },
  );

  // ---------- lister_objets ----------
  server.registerTool(
    "lister_objets",
    {
      title: "Lister les objets (arbre)",
      description:
        "Liste les objets dans l'ordre de l'arbre, avec leur chemin et les cumuls de tâches ouvertes de leur branche " +
        "(objet + descendants). Filtres facultatifs : sous-arbre d'un objet, profondeur maximale, type, recherche dans le nom ou la description.",
      inputSchema: {
        racine_id: UUID.optional().describe("Ne lister que cet objet et ses descendants"),
        profondeur_max: z.number().int().min(0).max(50).optional().describe("Profondeur maximale sous la racine (0 = la racine seule)"),
        type: z.string().max(60).optional().describe("Nom de type d'objet (ex. bâtiment, terrain, véhicule)"),
        recherche: z.string().max(100).optional().describe("Texte cherché dans le nom ou la description"),
        limite: z.number().int().min(1).max(1000).default(300),
      },
      annotations: READ_ONLY,
    },
    async ({ racine_id, profondeur_max, type, recherche, limite }) => {
      const { objs, nodes } = await forest();
      let list: TreeNode<ObjectRow>[] = nodes;
      let baseDepth = 0;
      if (racine_id) {
        const root = nodes.find((n) => n.id === racine_id);
        if (!root) return error(`Objet ${racine_id} introuvable`);
        const ids = subtreeIds(objs, racine_id);
        list = nodes.filter((n) => ids.has(n.id));
        baseDepth = root.depth;
      }
      if (profondeur_max !== undefined) list = list.filter((n) => n.depth - baseDepth <= profondeur_max);
      if (type) list = list.filter((n) => n.type?.toLowerCase() === type.toLowerCase());
      if (recherche) {
        const q = recherche.toLowerCase();
        list = list.filter((n) => n.name.toLowerCase().includes(q) || richTextToPlain(n.description).toLowerCase().includes(q));
      }
      return result({
        total: list.length,
        tronque: list.length > limite,
        objets: list.slice(0, limite).map((n) => ({
          id: n.id,
          nom: n.name,
          type: n.type,
          chemin: chemin(objs, n.id),
          profondeur: n.depth,
          parent_id: n.parentId,
          sous_objets: n.children.length,
          taches_ouvertes: n.total.openCount,
          heures_estimees: n.total.estHours,
          valeur_estimee_eur: n.total.estValueEur,
          url: objectUrl(n.id),
        })),
      });
    },
  );

  // ---------- obtenir_objet ----------
  server.registerTool(
    "obtenir_objet",
    {
      title: "Détail d'un objet",
      description:
        "Fiche complète d'un objet : chemin, type, description (texte), emplacement, tags, sous-objets directs, " +
        "bilan de la branche, tâches de l'objet et de ses descendants, documents (avec lien vers la visionneuse) et liens web.",
      inputSchema: {
        id: UUID.describe("Identifiant de l'objet"),
        inclure_taches_faites: z.boolean().default(false).describe("Inclure aussi les tâches terminées"),
      },
      annotations: READ_ONLY,
    },
    async ({ id, inclure_taches_faites }) => {
      const obj = await getObject(db, id);
      if (!obj) return error(`Objet ${id} introuvable`);
      const [{ objs, byId }, todos, docs, links, photos] = await Promise.all([
        forest(),
        listTodos(db, { subtreeOf: id, statuses: inclure_taches_faites ? undefined : ["a_faire", "en_cours"] }),
        listDocuments(db, { objectId: id }),
        listLinks(db, { objectId: id }),
        listPhotos(db, { objectId: id }),
      ]);
      const node = byId.get(id)!;
      return result({
        id: obj.id,
        nom: obj.name,
        type: obj.type,
        chemin: chemin(objs, id),
        parent_id: obj.parentId,
        description: richTextToPlain(obj.description),
        emplacement: obj.location,
        tags: obj.tags,
        sous_objets: node.children.map((c) => ({ id: c.id, nom: c.name, type: c.type, taches_ouvertes: c.total.openCount, url: objectUrl(c.id) })),
        bilan_branche: {
          taches_ouvertes: node.total.openCount,
          heures_estimees: node.total.estHours,
          valeur_estimee_eur: node.total.estValueEur,
        },
        taches: todos.map((t) => todoSummary(objs, t)),
        documents: docs.map((d) => ({ id: d.id, nom: d.filename, type: d.typeName, format: d.contentType, taille_octets: d.size, ajoute_le: d.createdAt.toISOString().slice(0, 10), url: docUrl(d.id) })),
        liens: links.map((l) => ({ titre: l.title, url: l.url })),
        photos: photos.length,
        url: objectUrl(id),
      });
    },
  );

  // ---------- rechercher_taches ----------
  server.registerTool(
    "rechercher_taches",
    {
      title: "Rechercher des tâches",
      description:
        "Recherche de tâches avec filtres (texte, statut, objet et tout son sous-arbre, responsable, catégorie, priorité, tag, échéance) et tri. " +
        "Par défaut : tâches ouvertes (à faire + en cours), triées par échéance.",
      inputSchema: {
        recherche: z.string().max(100).optional().describe("Texte cherché dans le titre et la description"),
        statut: z.enum(["ouvertes", "a_faire", "en_cours", "fait", "toutes"]).default("ouvertes"),
        objet_id: UUID.optional().describe("Tâches de cet objet et de tous ses descendants"),
        responsable: z.string().max(100).optional().describe("Nom ou e-mail du responsable, « moi », ou « personne » (non attribuées)"),
        categorie: z.enum(CATEGORIES).optional(),
        priorite: z.enum(PRIORITIES).optional(),
        tag: z.string().max(40).optional(),
        echeance_avant: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Échéance au plus tard ce jour (AAAA-MM-JJ)"),
        en_retard: z.boolean().optional().describe("Seulement les tâches ouvertes dont l'échéance est passée"),
        tri: z.enum(["echeance", "priorite", "ratio", "recent"]).default("echeance").describe("ratio = euros par heure décroissant"),
        limite: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const filters: TodoFilters = {};
      if (a.statut === "ouvertes") filters.statuses = ["a_faire", "en_cours"];
      else if (a.statut !== "toutes") filters.statuses = [a.statut];
      if (a.en_retard) {
        filters.statuses = ["a_faire", "en_cours"];
        const d = new Date(`${today()}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        filters.dueBefore = d.toISOString().slice(0, 10);
      }
      if (a.echeance_avant) filters.dueBefore = filters.dueBefore && filters.dueBefore < a.echeance_avant ? filters.dueBefore : a.echeance_avant;
      if (a.recherche) filters.q = a.recherche;
      if (a.objet_id) {
        if (!(await getObject(db, a.objet_id))) return error(`Objet ${a.objet_id} introuvable`);
        filters.subtreeOf = a.objet_id;
      }
      if (a.categorie) filters.category = a.categorie;
      if (a.priorite) filters.priority = a.priorite;
      if (a.tag) filters.tag = a.tag.toLowerCase();
      if (a.responsable) {
        const r = a.responsable.trim().toLowerCase();
        if (r === "moi") filters.assigneeId = user.id;
        else if (r === "personne") filters.assigneeId = "none";
        else {
          const who = (await listUsers(db)).find((u) => u.email.toLowerCase() === r || u.name.toLowerCase() === r);
          if (!who) return error(`Responsable « ${a.responsable} » inconnu. Utilise vue_ensemble pour la liste des utilisateurs.`);
          filters.assigneeId = who.id;
        }
      }
      const [objs, todos] = await Promise.all([listObjects(db), listTodos(db, filters, a.tri as TodoSort)]);
      return result({
        total: todos.length,
        tronque: todos.length > a.limite,
        taches: todos.slice(0, a.limite).map((t) => todoSummary(objs, t)),
      });
    },
  );

  // ---------- obtenir_tache ----------
  server.registerTool(
    "obtenir_tache",
    {
      title: "Détail d'une tâche",
      description: "Fiche complète d'une tâche : description (texte), sous-tâches, objet et chemin, valeurs, dates, responsable, documents et liens.",
      inputSchema: { id: UUID.describe("Identifiant de la tâche") },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const t = await getTodo(db, id);
      if (!t) return error(`Tâche ${id} introuvable`);
      const [objs, people, docs, links, photos, subs] = await Promise.all([
        listObjects(db),
        listUsers(db),
        listDocuments(db, { todoId: id }),
        listLinks(db, { todoId: id }),
        listPhotos(db, { todoId: id }),
        listSubtasks(db, id),
      ]);
      const name = (uid: string | null) => (uid ? (people.find((u) => u.id === uid)?.name ?? null) : null);
      const obj = objs.find((o) => o.id === t.objectId);
      return result({
        id: t.id,
        titre: t.title,
        description: richTextToPlain(t.description),
        statut: STATUS_LABEL[t.status],
        priorite: t.priority,
        categorie: t.category,
        echeance: t.dueDate,
        en_retard: t.status !== "fait" && !!t.dueDate && t.dueDate < today(),
        recurrence: t.recurrence,
        objet: { id: t.objectId, nom: obj?.name, chemin: chemin(objs, t.objectId), url: objectUrl(t.objectId) },
        responsable: name(t.assigneeId),
        cree_par: name(t.createdById),
        cree_le: t.createdAt.toISOString().slice(0, 10),
        termine_le: t.doneAt ? t.doneAt.toISOString().slice(0, 10) : null,
        heures_estimees: t.estHours,
        valeur_estimee_eur: t.estValueEur,
        heures_realisees: t.actualHours,
        valeur_realisee_eur: t.actualValueEur,
        euros_par_heure: t.estHours && t.estValueEur ? Math.round((t.estValueEur / t.estHours) * 100) / 100 : null,
        tags: t.tags,
        sous_taches: subs.map((st) => ({ texte: st.title, faite: st.done })),
        documents: docs.map((d) => ({ id: d.id, nom: d.filename, type: d.typeName, format: d.contentType, taille_octets: d.size, url: docUrl(d.id) })),
        liens: links.map((l) => ({ titre: l.title, url: l.url })),
        photos: photos.length,
        url: todoUrl(t.id),
      });
    },
  );

  // ---------- consulter_historique ----------
  server.registerTool(
    "consulter_historique",
    {
      title: "Historique des actions",
      description:
        "Journal des actions (création, modification, changement de statut, déplacement, suppression, photos, documents, liens, sous-tâches) " +
        "avec la date, l'auteur et l'origine (interface, api, mcp). objet_id : l'objet et ses tâches ; tache_id : une tâche ; sans filtre : tout Carnet. " +
        "Les plus récentes d'abord.",
      inputSchema: {
        objet_id: UUID.optional(),
        tache_id: UUID.optional(),
        origine: z.enum(["interface", "api", "mcp", "systeme"]).optional(),
        apres: UUID.optional().describe("Pour la suite : valeur `suite` de la réponse précédente"),
        limite: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const rows = await listAudit(db, {
        objectId: a.objet_id,
        todoId: a.tache_id,
        source: a.origine,
        afterId: a.apres,
        limit: a.limite,
      });
      return result({
        entrees: rows.map((e) => ({
          date: e.at.toISOString(),
          origine: e.source,
          application: e.client,
          auteur: e.userName,
          action: e.action,
          element: { type: e.entityKind, id: e.entityId, nom: e.entityLabel },
          details: describeDetails(e),
        })),
        suite: rows.length === a.limite ? rows[rows.length - 1].id : null,
      });
    },
  );

  if (write) registerWriteTools(server, { db, user, client, objectUrl, todoUrl });

  return server;
}
