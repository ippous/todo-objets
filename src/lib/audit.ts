// Journal des actions sur les objets et les tâches : qui, quand, par quel canal (interface, API, MCP), quoi.
// Les fonctions d'écriture de repo.ts reçoivent un `Actor` facultatif et appellent `logAction`.
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, objects, todos, users, type AuditEntry, type AuditSource, type Todo, type User } from "@/db/schema";
import { CATEGORY_LABEL, fmtDate, PRIORITY_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "./format";

/** Auteur d'une action et canal utilisé. */
export type Actor = { userId: string | null; userName: string; source: AuditSource; client?: string | null };

export const actorOf = (user: Pick<User, "id" | "name">, source: AuditSource, client?: string | null): Actor => ({
  userId: user.id,
  userName: user.name,
  source,
  client: client ?? null,
});

export type AuditAction =
  | "creation"
  | "modification"
  | "changement_statut"
  | "deplacement"
  | "suppression"
  | "ajout_photo"
  | "suppression_photo"
  | "choix_vignette"
  | "ajout_document"
  | "suppression_document"
  | "type_document"
  | "ajout_lien"
  | "suppression_lien"
  | "ajout_sous_tache"
  | "modification_sous_tache"
  | "suppression_sous_tache"
  | "ordre_sous_taches";

/** Élément concerné : un objet, ou une tâche (avec son objet). */
export type AuditTarget = { kind: "objet" | "tache"; id: string; label: string; objectId: string | null };

export const objectTarget = (o: { id: string; name: string }): AuditTarget => ({ kind: "objet", id: o.id, label: o.name, objectId: o.id });
export const todoTarget = (t: { id: string; title: string; objectId: string }): AuditTarget => ({
  kind: "tache",
  id: t.id,
  label: t.title,
  objectId: t.objectId,
});

/** Objet ou tâche propriétaire d'une photo, d'un document ou d'un lien. */
export async function ownerTarget(db: Db, owner: { objectId: string } | { todoId: string }): Promise<AuditTarget | null> {
  if ("objectId" in owner) {
    const [o] = await db.select({ id: objects.id, name: objects.name }).from(objects).where(eq(objects.id, owner.objectId));
    return o ? objectTarget(o) : null;
  }
  const [t] = await db.select({ id: todos.id, title: todos.title, objectId: todos.objectId }).from(todos).where(eq(todos.id, owner.todoId));
  return t ? todoTarget(t) : null;
}

export const ownerOf = (row: { objectId: string | null; todoId: string | null }) =>
  row.objectId ? { objectId: row.objectId } : { todoId: row.todoId! };

export type AuditRow = { target: AuditTarget; action: AuditAction; details?: Record<string, unknown> | null };

/** Enregistre une ou plusieurs actions. Sans auteur (scripts, tests), rien n'est enregistré. */
export async function logAction(db: Db, actor: Actor | undefined, ...rows: AuditRow[]): Promise<void> {
  if (!actor || rows.length === 0) return;
  await db.insert(auditLog).values(
    rows.map((r) => ({
      source: actor.source,
      client: actor.client?.slice(0, 120) || null,
      userId: actor.userId,
      userName: actor.userName,
      entityKind: r.target.kind,
      entityId: r.target.id,
      entityLabel: r.target.label,
      objectId: r.target.objectId,
      action: r.action,
      details: r.details && Object.keys(r.details).length ? r.details : null,
    })),
  );
}

// ---------- Différences avant / après ----------

export type Change = { avant: unknown; apres: unknown };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Champs qui ont changé entre deux instantanés, sous la forme { champ: { avant, apres } }. */
export function diff<T extends Record<string, unknown>>(before: T, after: T): Record<string, Change> {
  const out: Record<string, Change> = {};
  for (const k of Object.keys(after)) {
    if (!same(before[k], after[k])) out[k] = { avant: before[k] ?? null, apres: after[k] ?? null };
  }
  return out;
}

/** Instantané lisible d'un objet (noms plutôt qu'identifiants). */
export const objectSnapshot = (o: { name: string; type: string | null; description: string | null; location: string | null; tags: string[] }) => ({
  nom: o.name,
  type: o.type,
  description: o.description,
  emplacement: o.location,
  tags: o.tags,
});

/** Instantané lisible d'une tâche (noms de l'objet et du responsable). */
export async function todoSnapshot(db: Db, t: Todo) {
  const [obj] = await db.select({ name: objects.name }).from(objects).where(eq(objects.id, t.objectId));
  const [who] = t.assigneeId ? await db.select({ name: users.name }).from(users).where(eq(users.id, t.assigneeId)) : [];
  return {
    titre: t.title,
    objet: obj?.name ?? null,
    description: t.description,
    statut: t.status,
    priorite: t.priority,
    categorie: t.category,
    echeance: t.dueDate,
    recurrence: t.recurrence,
    responsable: who?.name ?? null,
    heures_estimees: t.estHours,
    valeur_estimee_eur: t.estValueEur,
    heures_realisees: t.actualHours,
    valeur_realisee_eur: t.actualValueEur,
    tags: t.tags,
  };
}

// ---------- Lecture ----------

export type AuditFilter = {
  /** Objet et ses tâches */
  objectId?: string;
  /** Une tâche */
  todoId?: string;
  source?: AuditSource;
  userId?: string;
  /** Entrées plus anciennes que celle-ci (pagination) */
  afterId?: string;
  limit?: number;
};

export async function listAudit(db: Db, f: AuditFilter = {}): Promise<AuditEntry[]> {
  const conds: SQL[] = [];
  if (f.objectId) conds.push(eq(auditLog.objectId, f.objectId));
  if (f.todoId) conds.push(and(eq(auditLog.entityKind, "tache"), eq(auditLog.entityId, f.todoId))!);
  if (f.source) conds.push(eq(auditLog.source, f.source));
  if (f.userId) conds.push(eq(auditLog.userId, f.userId));
  if (f.afterId) {
    conds.push(sql`(${auditLog.at}, ${auditLog.id}) < (SELECT a.at, a.id FROM audit_log a WHERE a.id = ${f.afterId})`);
  }
  return db
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(Math.min(Math.max(f.limit ?? 50, 1), 500));
}

// ---------- Libellés ----------

export const SOURCE_LABEL: Record<AuditSource, string> = { interface: "Interface", api: "API", mcp: "MCP", systeme: "Système" };

export const ACTION_LABEL: Record<string, string> = {
  creation: "Création",
  modification: "Modification",
  changement_statut: "Changement de statut",
  deplacement: "Déplacement",
  suppression: "Suppression",
  ajout_photo: "Ajout de photo",
  suppression_photo: "Suppression de photo",
  choix_vignette: "Choix de la vignette",
  ajout_document: "Ajout de document",
  suppression_document: "Suppression de document",
  type_document: "Changement de type de document",
  ajout_lien: "Ajout de lien",
  suppression_lien: "Suppression de lien",
  ajout_sous_tache: "Ajout de sous-tâche",
  modification_sous_tache: "Modification de sous-tâche",
  suppression_sous_tache: "Suppression de sous-tâche",
  ordre_sous_taches: "Réorganisation des sous-tâches",
};

const FIELD_LABEL: Record<string, string> = {
  nom: "Nom",
  type: "Type",
  description: "Description",
  emplacement: "Emplacement",
  tags: "Tags",
  titre: "Titre",
  objet: "Objet",
  statut: "Statut",
  priorite: "Priorité",
  categorie: "Catégorie",
  echeance: "Échéance",
  recurrence: "Récurrence",
  responsable: "Responsable",
  heures_estimees: "Durée estimée",
  valeur_estimee_eur: "Valeur estimée",
  heures_realisees: "Durée réalisée",
  valeur_realisee_eur: "Valeur réalisée",
  fait: "Cochée",
};

function fmtValue(field: string, v: unknown): string {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  if (field === "statut") return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? String(v);
  if (field === "priorite") return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? String(v);
  if (field === "categorie") return CATEGORY_LABEL[v as keyof typeof CATEGORY_LABEL] ?? String(v);
  if (field === "recurrence") return RECURRENCE_LABEL[v as keyof typeof RECURRENCE_LABEL] ?? String(v);
  if (field === "echeance") return fmtDate(String(v));
  if (field.startsWith("heures_")) return `${String(v).replace(".", ",")} h`;
  if (field.startsWith("valeur_")) return `${String(v).replace(".", ",")} €`;
  if (field === "fait") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.map((t) => `#${t}`).join(" ");
  return String(v);
}

/** Lignes lisibles décrivant le détail d'une entrée du journal. */
export function describeDetails(e: Pick<AuditEntry, "action" | "details">): string[] {
  const d = (e.details ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  const changes = d.changements as Record<string, Change> | undefined;
  if (changes) {
    for (const [k, c] of Object.entries(changes)) {
      const label = FIELD_LABEL[k] ?? k;
      lines.push(k === "description" ? `${label} modifiée` : `${label} : ${fmtValue(k, c.avant)} → ${fmtValue(k, c.apres)}`);
    }
  }
  if (typeof d.parent === "string") lines.push(`Sous ${d.parent}`);
  if (typeof d.objet === "string") lines.push(`Objet : ${d.objet}`);
  if ("de" in d || "vers" in d) lines.push(`De ${d.de ?? "(racine)"} vers ${d.vers ?? "(racine)"}`);
  if (typeof d.occurrence_de === "string") lines.push(`Occurrence suivante de « ${d.occurrence_de} »`);
  if (typeof d.fichier === "string") lines.push(d.type ? `${d.fichier} (${d.type})` : d.fichier);
  if (typeof d.url === "string") lines.push(d.titre ? `${d.titre} — ${d.url}` : d.url);
  else if (typeof d.titre === "string") lines.push(`« ${d.titre} »`);
  if (d.lot) lines.push("Ajout en lot");
  return lines;
}
