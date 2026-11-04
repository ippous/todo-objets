import "server-only";
// Outils MCP de SUPPRESSION (accès « lecture ecriture suppression » uniquement).
// Chaque suppression est définitive : les fichiers (photos, documents) sont effacés du stockage.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { actorOf, type Actor } from "./audit";
import { fail, guard, ok, UUID, type Ctx } from "./mcp-write-tools";
import { deleteDocument, deleteLink, deleteObject, deletePhoto, deleteSubtask, deleteTodo, getDocument, getObject, getPhoto, getTodo } from "./repo";
import { remove } from "./storage";

const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
const WARNING = " Suppression définitive : demande confirmation à l'utilisateur avant d'appeler cet outil.";

export function registerDeleteTools(server: McpServer, { db, user, client, objectUrl, todoUrl }: Ctx) {
  const actor: Actor = actorOf(user, "mcp", client);
  const pageOf = (o: { objectId: string | null; todoId: string | null }) => (o.objectId ? objectUrl(o.objectId) : todoUrl(o.todoId!));

  // ---------- supprimer_tache ----------
  server.registerTool(
    "supprimer_tache",
    {
      title: "Supprimer une tâche",
      description: "Supprime une tâche avec ses sous-tâches, photos, documents et liens." + WARNING,
      inputSchema: { id: UUID.describe("Identifiant de la tâche") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        const t = await getTodo(db, a.id);
        if (!t) return fail(`Tâche ${a.id} introuvable`);
        await remove(await deleteTodo(db, a.id, actor));
        return ok({ supprime: true, id: a.id, titre: t.title, objet: objectUrl(t.objectId) });
      }),
  );

  // ---------- supprimer_objet ----------
  server.registerTool(
    "supprimer_objet",
    {
      title: "Supprimer un objet",
      description:
        "Supprime un objet sans sous-objet ni tâche (sinon refusé : déplace ou supprime-les d'abord), avec ses photos, documents et liens." + WARNING,
      inputSchema: { id: UUID.describe("Identifiant de l'objet") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        const o = await getObject(db, a.id);
        if (!o) return fail(`Objet ${a.id} introuvable`);
        await remove(await deleteObject(db, a.id, actor));
        return ok({ supprime: true, id: a.id, nom: o.name, parent: o.parentId ? objectUrl(o.parentId) : null });
      }),
  );

  // ---------- supprimer_sous_tache ----------
  server.registerTool(
    "supprimer_sous_tache",
    {
      title: "Supprimer une sous-tâche",
      description: "Supprime une sous-tâche (identifiant donné par obtenir_tache)." + WARNING,
      inputSchema: { id: UUID.describe("Identifiant de la sous-tâche") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        await deleteSubtask(db, a.id, actor);
        return ok({ supprime: true, id: a.id });
      }),
  );

  // ---------- supprimer_photo ----------
  server.registerTool(
    "supprimer_photo",
    {
      title: "Supprimer une photo",
      description:
        "Supprime une photo d'un objet ou d'une tâche (identifiant donné par obtenir_objet / obtenir_tache). Si c'était la vignette, la plus ancienne photo restante prend le relais." +
        WARNING,
      inputSchema: { id: UUID.describe("Identifiant de la photo") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        const p = await getPhoto(db, a.id);
        if (!p || (!p.objectId && !p.todoId)) return fail(`Photo ${a.id} introuvable`);
        if (p.inline) return fail("Cette image fait partie d'une description : modifie la description à la place.");
        await remove(await deletePhoto(db, a.id, actor));
        return ok({ supprime: true, id: a.id, page: pageOf(p) });
      }),
  );

  // ---------- supprimer_document ----------
  server.registerTool(
    "supprimer_document",
    {
      title: "Supprimer un document",
      description: "Supprime un document (identifiant donné par obtenir_objet / obtenir_tache) et son fichier." + WARNING,
      inputSchema: { id: UUID.describe("Identifiant du document") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        const d = await getDocument(db, a.id);
        if (!d) return fail(`Document ${a.id} introuvable`);
        await remove([await deleteDocument(db, a.id, actor)]);
        return ok({ supprime: true, id: a.id, nom: d.filename, page: pageOf(d) });
      }),
  );

  // ---------- supprimer_lien ----------
  server.registerTool(
    "supprimer_lien",
    {
      title: "Supprimer un lien",
      description: "Supprime un lien web (identifiant donné par obtenir_objet / obtenir_tache)." + WARNING,
      inputSchema: { id: UUID.describe("Identifiant du lien") },
      annotations: DELETE,
    },
    async (a) =>
      guard(async () => {
        await deleteLink(db, a.id, actor);
        return ok({ supprime: true, id: a.id });
      }),
  );
}
