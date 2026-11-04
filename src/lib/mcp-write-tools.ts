import "server-only";
// Outils MCP d'ÉCRITURE (accès « lecture ecriture » ou plus).
// Créer / modifier des tâches et des sous-tâches, créer / modifier / déplacer des objets, ajouter des liens,
// des photos et des documents, créer des types. Les suppressions sont dans mcp-delete-tools.ts (droit à part).
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "@/db";
import { PRIORITIES, RECURRENCES, STATUSES, type NewTodo, type User } from "@/db/schema";
import { actorOf, type Actor } from "./audit";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, documentType, formatSize, safeFileName } from "./document-types";
import { decodeBase64Image, ImageError, processImage } from "./photo-processing";
import {
  addDocument,
  addLink,
  addPhoto,
  addSubtask,
  createObject,
  createTodo,
  createType,
  DomainError,
  getDocument,
  getPhoto,
  findTaskTypeByName,
  getObject,
  getTodo,
  listTypes,
  listUsers,
  moveObject,
  setDocumentDescription,
  setDocumentType,
  setLinkDescription,
  setPhotoDescription,
  setTodoStatus,
  SUBTASK_MAX_LENGTH,
  updateObject,
  updateSubtask,
  updateTodo,
  type TypeKind,
} from "./repo";
import { isTaskIcon } from "./task-icons";
import { markdownToRichText } from "./rich-text";
import { findSchemeByName, getDefaultSchemeId, listReminderSchemes } from "./reminder-repo";
import { DEPENDENCIES_MAX, setDependencies } from "./dependencies";
import { notifyReady } from "./notify-ready";
import { remove, save, storagePrefix } from "./storage";

export const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const UPDATE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

export const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ");
const TIME = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM")
  .describe("Heure d'échéance (heure de Paris), facultative ; demande une date d'échéance");
const RAPPELS = z
  .string()
  .max(60)
  .describe("Nom d'un schéma de rappel (voir vue_ensemble, schemas_rappel), ou « aucun »");
const AMOUNT = z.number().min(0).max(1e9);
const DESCRIPTION = z
  .string()
  .max(40_000)
  .describe("Texte en Markdown simple : ## titres, - listes, 1. listes, **gras**, *italique*, [lien](https://…), > citation");
const CAPTION = z.string().max(2000);
const TAGS = z.array(z.string().min(1).max(40)).max(20);

export type Ctx = {
  db: Db;
  user: User;
  client?: string | null;
  objectUrl: (id: string) => string;
  todoUrl: (id: string) => string;
  docUrl?: (id: string) => string;
};

export function ok(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
}
export function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
/** Erreurs métier renvoyées à l'assistant (lisibles), les autres remontent. */
export async function guard<T>(fn: () => Promise<T>) {
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

export function registerWriteTools(server: McpServer, { db, user, client, objectUrl, todoUrl, docUrl = (id) => id }: Ctx) {
  // Chaque écriture est inscrite au journal comme venant du MCP, avec le nom du jeton ou de l'application
  const actor: Actor = actorOf(user, "mcp", client);
  const origin = todoUrl("x").replace(/\/taches\/x$/, "");
  /** Tâche faite : prévient les tâches qui l'attendaient et sont désormais prêtes. */
  const onDone = async (id: string, title: string) => {
    await notifyReady(db, id, title, origin).catch((err) => console.error("notifyReady", err));
  };
  const DEPS = z
    .array(UUID)
    .max(DEPENDENCIES_MAX)
    .describe("Tâches à terminer avant celle-ci (identifiants) : elle est « bloquée » tant que l'une n'est pas faite ; les boucles sont refusées");

  async function resolveAssignee(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim().toLowerCase() === "personne" || raw.trim() === "") return null;
    const r = raw.trim().toLowerCase();
    if (r === "moi") return user.id;
    const who = (await listUsers(db)).find((u) => u.active && (u.email.toLowerCase() === r || u.name.toLowerCase() === r));
    if (!who) throw new DomainError(`Responsable « ${raw} » inconnu. Utilise vue_ensemble pour la liste des utilisateurs.`);
    return who.id;
  }

  async function resolveTaskType(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim() === "") return null;
    const types = await listTypes(db, "tache");
    const t = types.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!t) {
      throw new DomainError(
        `Type de tâche « ${raw} » inconnu. Types existants : ${types.map((x) => x.name).join(", ")}. (Un nouveau type se crée avec creer_type.)`,
      );
    }
    return t.id;
  }

  async function resolveObjectType(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim() === "") return null;
    const types = await listTypes(db, "objet");
    const t = types.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!t) {
      throw new DomainError(
        `Type d'objet « ${raw} » inconnu. Types existants : ${types.map((x) => x.name).join(", ")}. (Un nouveau type se crée avec creer_type.)`,
      );
    }
    return t.id;
  }

  /** Nom de schéma → identifiant ; « aucun » → null ; undefined → inchangé. */
  async function resolveScheme(raw: string | null | undefined): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw === null || raw.trim() === "" || /^aucuns?$/i.test(raw.trim())) return null;
    const found = await findSchemeByName(db, raw);
    if (!found) {
      const all = await listReminderSchemes(db);
      throw new DomainError(`Schéma de rappel « ${raw} » inconnu. Schémas existants : ${all.map((x) => x.name).join(", ") || "aucun"}.`);
    }
    return found.id;
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
        categorie: z.string().max(60).optional().describe("Type de tâche (voir vue_ensemble, types_taches) ; « Entretien » par défaut"),
        date_debut: DATE.optional().describe("Début prévu (AAAA-MM-JJ), au plus tard l'échéance"),
        echeance: DATE.optional(),
        heure_echeance: TIME.optional(),
        dependances: DEPS.optional(),
        rappels: RAPPELS.optional().describe("Schéma de rappel ; le schéma par défaut s'il y a une échéance et que rien n'est indiqué"),
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
        if (a.heure_echeance && !a.echeance) return fail("Une heure d'échéance demande une date d'échéance (echeance)");
        if (a.date_debut && a.echeance && a.date_debut > a.echeance) return fail("date_debut doit précéder l'échéance");
        const data: NewTodo = {
          objectId: a.objet_id,
          title: a.titre.trim(),
          description: markdownToRichText(a.description),
          status: a.statut === "fait" ? "a_faire" : a.statut,
          priority: a.priorite,
          typeId: a.categorie ? ((await resolveTaskType(a.categorie)) ?? null) : ((await findTaskTypeByName(db, "Entretien"))?.id ?? null),
          startDate: a.date_debut ?? null,
          dueDate: a.echeance ?? null,
          dueTime: a.echeance ? (a.heure_echeance ?? null) : null,
          reminderSchemeId: a.rappels !== undefined ? ((await resolveScheme(a.rappels)) ?? null) : a.echeance ? await getDefaultSchemeId(db) : null,
          recurrence: a.recurrence,
          assigneeId: (await resolveAssignee(a.responsable)) ?? null,
          estHours: a.heures_estimees ?? null,
          estValueEur: a.valeur_estimee_eur ?? null,
          tags: cleanTags(a.tags ?? []),
          createdById: user.id,
        };
        const t = await createTodo(db, data, actor);
        if (a.dependances?.length) await setDependencies(db, t.id, a.dependances, actor);
        if (a.statut === "fait") await setTodoStatus(db, t.id, "fait", { today: parisToday(), actor });
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
        categorie: z.string().max(60).nullable().optional().describe("Type de tâche (voir vue_ensemble), ou null pour aucun"),
        date_debut: DATE.nullable().optional(),
        echeance: DATE.nullable().optional(),
        heure_echeance: TIME.nullable().optional(),
        dependances: DEPS.optional().describe("Remplace la liste des tâches attendues ([] pour la vider)"),
        rappels: RAPPELS.nullable().optional(),
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
        const typeId = await resolveTaskType(a.categorie);
        if (typeId !== undefined) data.typeId = typeId;
        if (a.date_debut !== undefined) data.startDate = a.date_debut;
        if (a.echeance !== undefined) data.dueDate = a.echeance;
        if (a.heure_echeance !== undefined) data.dueTime = a.heure_echeance;
        {
          const s = data.startDate !== undefined ? data.startDate : before.startDate;
          const d = data.dueDate !== undefined ? data.dueDate : before.dueDate;
          if (s && d && s > d) return fail("date_debut doit précéder l'échéance");
        }
        if (a.dependances !== undefined) await setDependencies(db, a.id, a.dependances, actor);
        if (a.echeance === null) data.dueTime = null;
        if ((data.dueTime ?? null) !== null && (data.dueDate ?? before.dueDate) == null) {
          return fail("Une heure d'échéance demande une date d'échéance (echeance)");
        }
        const schemeId = await resolveScheme(a.rappels);
        if (schemeId !== undefined) data.reminderSchemeId = schemeId;
        if (a.recurrence !== undefined) data.recurrence = a.recurrence;
        const assignee = await resolveAssignee(a.responsable);
        if (assignee !== undefined) data.assigneeId = assignee;
        if (a.heures_estimees !== undefined) data.estHours = a.heures_estimees;
        if (a.valeur_estimee_eur !== undefined) data.estValueEur = a.valeur_estimee_eur;
        if (a.heures_realisees !== undefined) data.actualHours = a.heures_realisees;
        if (a.valeur_realisee_eur !== undefined) data.actualValueEur = a.valeur_realisee_eur;
        if (a.tags !== undefined) data.tags = cleanTags(a.tags);
        if (Object.keys(data).length) await updateTodo(db, a.id, data, actor);
        let suivante: string | null = null;
        if (a.statut !== undefined && a.statut !== before.status) {
          suivante = await setTodoStatus(db, a.id, a.statut, { today: parisToday(), actor });
          if (a.statut === "fait") await onDone(a.id, before.title);
        }
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
        }, actor);
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
        }, actor);
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
        await moveObject(db, a.id, a.nouveau_parent_id, actor);
        const [o, p] = await Promise.all([getObject(db, a.id), a.nouveau_parent_id ? getObject(db, a.nouveau_parent_id) : undefined]);
        return ok({ deplace: true, id: a.id, nom: o?.name, nouveau_parent: p?.name ?? "(racine)", url: objectUrl(a.id) });
      }),
  );

  // ---------- ajouter_lien ----------
  server.registerTool(
    "ajouter_lien",
    {
      title: "Ajouter un lien",
      description: "Ajoute un lien web (http/https) à un objet OU à une tâche (fournir exactement l'un des deux), avec un titre et une description facultatifs.",
      inputSchema: {
        objet_id: UUID.optional(),
        tache_id: UUID.optional(),
        url: z.string().min(3).max(2000),
        titre: z.string().max(200).optional(),
        description: CAPTION.optional().describe("Description du lien (texte simple)"),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        if (!!a.objet_id === !!a.tache_id) return fail("Fournis soit objet_id, soit tache_id (un seul des deux).");
        const owner = a.objet_id ? { objectId: a.objet_id } : { todoId: a.tache_id! };
        const l = await addLink(db, { owner, url: a.url, title: a.titre, description: a.description, createdById: user.id }, actor);
        return ok({
          ajoute: true,
          id: l.id,
          titre: l.title,
          description: l.description,
          url_lien: l.url,
          page: a.objet_id ? objectUrl(a.objet_id) : todoUrl(a.tache_id!),
        });
      }),
  );
  // ---------- ajouter_photo ----------
  server.registerTool(
    "ajouter_photo",
    {
      title: "Ajouter une photo",
      description:
        "Ajoute une même photo à une ou plusieurs tâches et/ou objets (50 au plus). L'image (JPEG, PNG, WebP, GIF, HEIC…, 10 Mo max) " +
        "est envoyée en base64 ; elle est redimensionnée (1600 px) et une vignette est créée. La première photo d'un élément devient sa vignette. " +
        "description : légende facultative.",
      inputSchema: {
        image_base64: z.string().min(16).max(14_000_000).describe("Contenu de l'image en base64 (ou adresse data:image/…;base64,…)"),
        tache_ids: z.array(UUID).max(50).optional(),
        objet_ids: z.array(UUID).max(50).optional(),
        description: CAPTION.optional().describe("Légende de la photo (texte simple), la même pour chaque élément"),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        const targets = [
          ...[...new Set(a.tache_ids ?? [])].map((id) => ({ kind: "taches" as const, id })),
          ...[...new Set(a.objet_ids ?? [])].map((id) => ({ kind: "objets" as const, id })),
        ];
        if (targets.length === 0) return fail("Indique au moins une tâche (tache_ids) ou un objet (objet_ids).");
        if (targets.length > 50) return fail("50 éléments au plus par appel.");
        let img: Awaited<ReturnType<typeof processImage>>;
        try {
          img = await processImage(decodeBase64Image(a.image_base64));
        } catch (err) {
          if (err instanceof ImageError) return fail(err.message);
          throw err;
        }
        const ajoutees: Record<string, unknown>[] = [];
        const erreurs: Record<string, unknown>[] = [];
        for (const t of targets) {
          const exists = t.kind === "taches" ? await getTodo(db, t.id) : await getObject(db, t.id);
          if (!exists) {
            erreurs.push({ [t.kind === "taches" ? "tache_id" : "objet_id"]: t.id, erreur: t.kind === "taches" ? "Tâche introuvable" : "Objet introuvable" });
            continue;
          }
          const base = `${storagePrefix}/${t.kind}/${t.id}/${randomUUID()}`;
          const pathname = `${base}.jpg`;
          const thumbPathname = `${base}-v.jpg`;
          await save(pathname, img.full, "image/jpeg");
          await save(thumbPathname, img.thumb, "image/jpeg");
          try {
            const p = await addPhoto(db, t.kind === "taches" ? { todoId: t.id } : { objectId: t.id }, {
              pathname,
              thumbPathname,
              width: img.width,
              height: img.height,
              createdById: user.id,
              description: a.description,
            }, actor);
            ajoutees.push({
              photo_id: p.id,
              ...(t.kind === "taches" ? { tache_id: t.id } : { objet_id: t.id }),
              vignette: p.isCover,
              url: t.kind === "taches" ? todoUrl(t.id) : objectUrl(t.id),
            });
          } catch (err) {
            await remove([pathname, thumbPathname]);
            if (err instanceof DomainError) erreurs.push({ id: t.id, erreur: err.message });
            else throw err;
          }
        }
        return ok({ ajoutees: ajoutees.length, dimensions: `${img.width}×${img.height}`, photos: ajoutees, erreurs });
      }),
  );
  async function resolveDocumentType(raw: string | undefined): Promise<{ id: string; name: string }> {
    const types = await listTypes(db, "document");
    if (!types.length) throw new DomainError("Aucun type de document : crée-en un avec creer_type (categorie « document »).");
    if (raw === undefined || raw.trim() === "") {
      return types.find((t) => t.name.toLowerCase() === "autre") ?? types[0];
    }
    const t = types.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
    if (!t) {
      throw new DomainError(
        `Type de document « ${raw} » inconnu. Types existants : ${types.map((x) => x.name).join(", ")}. (Un nouveau type se crée avec creer_type.)`,
      );
    }
    return t;
  }

  /** Contenu d'un document : base64, ou téléchargement d'une adresse https publique. */
  async function documentBytes(a: { fichier_base64?: string; url_source?: string }): Promise<{ bytes: Uint8Array; remoteType: string | null; remoteName: string | null }> {
    if (a.fichier_base64) {
      const b64 = a.fichier_base64.trim().replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw new DomainError("Base64 invalide");
      return { bytes: Buffer.from(b64, "base64"), remoteType: null, remoteName: null };
    }
    let url: URL;
    try {
      url = new URL(a.url_source!);
    } catch {
      throw new DomainError("Adresse url_source invalide");
    }
    if (url.protocol !== "https:") throw new DomainError("url_source doit être une adresse https");
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new DomainError(`Téléchargement impossible : ${url.host}`);
    }
    if (!res.ok || !res.body) throw new DomainError(`Téléchargement refusé (${res.status}) : ${url.host}`);
    const announced = Number(res.headers.get("content-length") ?? 0);
    if (announced > DOCUMENT_MAX_BYTES) throw new DomainError(`Fichier trop gros (${formatSize(announced)}, 25 Mo au plus)`);
    // Lecture limitée : on s'arrête dès que le maximum est dépassé
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DOCUMENT_MAX_BYTES) {
        await reader.cancel();
        throw new DomainError("Fichier trop gros (25 Mo au plus)");
      }
      chunks.push(value);
    }
    const remoteType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || null;
    const disposition = res.headers.get("content-disposition") ?? "";
    const fromHeader = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    const fromPath = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    let remoteName: string | null = null;
    try {
      remoteName = (fromHeader ? decodeURIComponent(fromHeader) : fromPath) || null;
    } catch {
      remoteName = fromPath || null;
    }
    return { bytes: Buffer.concat(chunks), remoteType, remoteName };
  }

  // ---------- ajouter_document ----------
  server.registerTool(
    "ajouter_document",
    {
      title: "Ajouter un document",
      description:
        "Ajoute un document (facture, garantie, mode d'emploi…) à un objet OU à une tâche (fournir exactement l'un des deux). " +
        "Contenu : fichier_base64 OU url_source (adresse https publique, téléchargée par Carnet). " +
        `Formats : ${[...new Set(Object.values(DOCUMENT_TYPES))].join(", ")} ; 25 Mo au plus ` +
        "(en base64, la requête est limitée à environ 4 Mo par l'hébergeur : préfère url_source pour les gros fichiers). " +
        "type_document : nom d'un type de document existant (voir vue_ensemble) ; « Autre » par défaut.",
      inputSchema: {
        objet_id: UUID.optional(),
        tache_id: UUID.optional(),
        nom_fichier: z.string().min(1).max(200).optional().describe("Nom avec extension (ex. facture-2026.pdf) ; obligatoire avec fichier_base64"),
        fichier_base64: z.string().min(4).max(35_000_000).optional().describe("Contenu en base64 (ou data:…;base64,…)"),
        url_source: z.string().min(8).max(2000).optional().describe("Adresse https du fichier à télécharger"),
        format: z.string().max(120).optional().describe("Type MIME (ex. application/pdf) ; déduit de l'extension sinon"),
        type_document: z.string().max(60).optional(),
        description: CAPTION.optional().describe("Description du document (texte simple)"),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        if (!!a.objet_id === !!a.tache_id) return fail("Fournis soit objet_id, soit tache_id (un seul des deux).");
        if (!!a.fichier_base64 === !!a.url_source) return fail("Fournis soit fichier_base64, soit url_source (un seul des deux).");
        if (a.fichier_base64 && !a.nom_fichier) return fail("nom_fichier est obligatoire avec fichier_base64 (pour connaître le format).");
        const owner = a.objet_id ? { objectId: a.objet_id } : { todoId: a.tache_id! };
        if (a.objet_id ? !(await getObject(db, a.objet_id)) : !(await getTodo(db, a.tache_id!))) {
          return fail(a.objet_id ? `Objet ${a.objet_id} introuvable` : `Tâche ${a.tache_id} introuvable`);
        }
        const docType = await resolveDocumentType(a.type_document);
        const { bytes, remoteType, remoteName } = await documentBytes(a);
        if (bytes.byteLength === 0) return fail("Le fichier est vide.");
        if (bytes.byteLength > DOCUMENT_MAX_BYTES) return fail(`Fichier trop gros (${formatSize(bytes.byteLength)}, 25 Mo au plus)`);
        const filename = (a.nom_fichier ?? remoteName ?? "document").trim().slice(0, 200);
        const contentType =
          (a.format && DOCUMENT_TYPES[a.format.toLowerCase()] ? a.format.toLowerCase() : null) ??
          documentType(filename, remoteType ?? "");
        if (!contentType) {
          return fail(`Format non accepté pour « ${filename} ». Formats possibles : ${[...new Set(Object.values(DOCUMENT_TYPES))].join(", ")}.`);
        }
        const base = a.objet_id ? `${storagePrefix}/documents/${a.objet_id}` : `${storagePrefix}/documents/taches/${a.tache_id}`;
        const pathname = `${base}/${randomUUID()}/${safeFileName(filename)}`;
        await save(pathname, bytes, contentType);
        try {
          const d = await addDocument(db, { owner, typeId: docType.id, pathname, filename, contentType, size: bytes.byteLength, createdById: user.id, description: a.description }, actor);
          return ok({
            ajoute: true,
            id: d.id,
            nom: d.filename,
            type: docType.name,
            format: DOCUMENT_TYPES[contentType],
            taille: formatSize(d.size),
            description: d.description,
            url: docUrl(d.id),
            page: a.objet_id ? objectUrl(a.objet_id) : todoUrl(a.tache_id!),
          });
        } catch (err) {
          await remove([pathname]);
          throw err;
        }
      }),
  );

  // ---------- modifier_document ----------
  server.registerTool(
    "modifier_document",
    {
      title: "Modifier un document",
      description: "Change le type et / ou la description d'un document (identifiant donné par obtenir_objet / obtenir_tache) ; description null l'efface.",
      inputSchema: {
        id: UUID.describe("Identifiant du document"),
        type_document: z.string().min(1).max(60).optional().describe("Nom d'un type de document existant"),
        description: CAPTION.nullable().optional(),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        const d = await getDocument(db, a.id);
        if (!d) return fail(`Document ${a.id} introuvable`);
        if (a.type_document === undefined && a.description === undefined) return fail("Indique type_document et / ou description.");
        let typeName: string | undefined;
        if (a.type_document !== undefined) {
          const t = await resolveDocumentType(a.type_document);
          if (t.id !== d.typeId) await setDocumentType(db, a.id, t.id, actor);
          typeName = t.name;
        }
        const after = a.description !== undefined ? await setDocumentDescription(db, a.id, a.description, actor) : d;
        return ok({ modifie: true, id: a.id, nom: d.filename, type: typeName, description: after.description, url: docUrl(a.id) });
      }),
  );

  // ---------- modifier_lien ----------
  server.registerTool(
    "modifier_lien",
    {
      title: "Modifier un lien",
      description: "Change la description d'un lien (identifiant donné par obtenir_objet / obtenir_tache) ; null l'efface.",
      inputSchema: {
        id: UUID.describe("Identifiant du lien"),
        description: CAPTION.nullable(),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        const l = await setLinkDescription(db, a.id, a.description, actor);
        return ok({ modifie: true, id: l.id, titre: l.title, url_lien: l.url, description: l.description });
      }),
  );

  // ---------- ajouter_sous_taches ----------
  const SUB_HOURS = z.number().min(0).max(999_999);
  server.registerTool(
    "ajouter_sous_taches",
    {
      title: "Ajouter des sous-tâches",
      description: "Ajoute une ou plusieurs sous-tâches (étapes à cocher) à la fin de la liste d'une tâche, avec leur durée estimée ou réalisée si besoin.",
      inputSchema: {
        tache_id: UUID,
        sous_taches: z
          .array(
            z.object({
              texte: z.string().min(1).max(SUBTASK_MAX_LENGTH),
              heures_estimees: SUB_HOURS.optional(),
              heures_realisees: SUB_HOURS.optional(),
              faite: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(50),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        if (!(await getTodo(db, a.tache_id))) return fail(`Tâche ${a.tache_id} introuvable`);
        const ajoutees: Record<string, unknown>[] = [];
        for (const st of a.sous_taches) {
          const row = await addSubtask(db, a.tache_id, st.texte, actor, { estHours: st.heures_estimees, actualHours: st.heures_realisees });
          if (st.faite) await updateSubtask(db, row.id, { done: true }, actor);
          ajoutees.push({ id: row.id, texte: row.title, faite: !!st.faite });
        }
        return ok({ ajoutees: ajoutees.length, sous_taches: ajoutees, url: todoUrl(a.tache_id) });
      }),
  );

  // ---------- modifier_sous_tache ----------
  server.registerTool(
    "modifier_sous_tache",
    {
      title: "Modifier une sous-tâche",
      description: "Modifie le texte, l'état (cochée ou non) ou les durées d'une sous-tâche ; null efface une durée.",
      inputSchema: {
        id: UUID.describe("Identifiant de la sous-tâche (voir obtenir_tache)"),
        texte: z.string().min(1).max(SUBTASK_MAX_LENGTH).optional(),
        faite: z.boolean().optional(),
        heures_estimees: SUB_HOURS.nullable().optional(),
        heures_realisees: SUB_HOURS.nullable().optional(),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        await updateSubtask(db, a.id, { title: a.texte, done: a.faite, estHours: a.heures_estimees, actualHours: a.heures_realisees }, actor);
        return ok({ modifie: true, id: a.id, champs_modifies: Object.keys(a).filter((k) => k !== "id") });
      }),
  );

  // ---------- creer_type ----------
  const KIND: Record<string, TypeKind> = { objet: "objet", document: "document", tache: "tache" };
  server.registerTool(
    "creer_type",
    {
      title: "Créer un type",
      description:
        "Crée un type d'objet (bâtiment, véhicule…), de document (facture, garantie…) ou de tâche (catégorie : entretien, réparation…). " +
        "Le nom doit être nouveau (sans tenir compte des majuscules). icone : uniquement pour un type de tâche (clé d'icône Carnet, facultative).",
      inputSchema: {
        categorie: z.enum(["objet", "document", "tache"]),
        nom: z.string().min(1).max(60),
        icone: z.string().max(40).optional(),
      },
      annotations: CREATE,
    },
    async (a) =>
      guard(async () => {
        if (a.icone && a.categorie !== "tache") return fail("icone n'existe que pour les types de tâche.");
        if (a.icone && !isTaskIcon(a.icone)) return fail(`Icône « ${a.icone} » inconnue.`);
        const t = await createType(db, KIND[a.categorie], a.nom, a.icone ?? null);
        return ok({ cree: true, categorie: a.categorie, id: t.id, nom: t.name });
      }),
  );
  // ---------- modifier_photo ----------
  server.registerTool(
    "modifier_photo",
    {
      title: "Modifier une photo",
      description: "Change la description (légende) d'une photo (identifiant donné par obtenir_objet / obtenir_tache) ; null l'efface.",
      inputSchema: {
        id: UUID.describe("Identifiant de la photo"),
        description: CAPTION.nullable(),
      },
      annotations: UPDATE,
    },
    async (a) =>
      guard(async () => {
        if (!(await getPhoto(db, a.id))) return fail(`Photo ${a.id} introuvable`);
        const p = await setPhotoDescription(db, a.id, a.description, actor);
        return ok({ modifie: true, id: p.id, description: p.description, page: p.objectId ? objectUrl(p.objectId) : todoUrl(p.todoId!) });
      }),
  );
}
