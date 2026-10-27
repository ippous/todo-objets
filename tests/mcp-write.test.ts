import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { users, type User } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp-server";
import { createObject, getObject, getTodo, listLinks } from "@/lib/repo";
import { createTestDb } from "./helpers";

let db: Db;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  [user] = await db.insert(users).values({ email: "a@exemple.fr", name: "Alice", role: "admin" }).returning();
});

async function connect(write: boolean) {
  const server = buildMcpServer(db, user, "https://carnet.test", write);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { error: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call };
}

const WRITE_TOOLS = ["creer_tache", "modifier_tache", "creer_objet", "modifier_objet", "deplacer_objet", "ajouter_lien"];

describe("MCP — droits", () => {
  it("lecture seule : aucun outil d'écriture", async () => {
    const { client } = await connect(false);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("rechercher_taches");
    for (const n of WRITE_TOOLS) expect(names).not.toContain(n);
  });

  it("écriture : outils présents, aucun outil de suppression", async () => {
    const { client } = await connect(true);
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const n of WRITE_TOOLS) expect(names).toContain(n);
    expect(names.some((n) => /suppr|delete|effacer/.test(n))).toBe(false);
    expect(tools.find((t) => t.name === "creer_tache")?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("MCP — écriture", () => {
  it("objets : créer, modifier, déplacer (boucle refusée)", async () => {
    const { call } = await connect(true);
    const root = await call("creer_objet", { nom: "Ferme", description: "## Bâtiments\n- grange\n- **étable**" });
    expect(root.data.url).toBe(`https://carnet.test/objets/${root.data.id}`);
    expect((await getObject(db, root.data.id))?.description).toBe("<h2>Bâtiments</h2><ul><li><p>grange</p></li><li><p><strong>étable</strong></p></li></ul>");
    const child = await call("creer_objet", { nom: "Grange", parent_id: root.data.id, emplacement: "Nord", tags: ["Bois", "bois"] });
    expect(await getObject(db, child.data.id)).toMatchObject({ parentId: root.data.id, location: "Nord", tags: ["bois"] });

    expect((await call("creer_objet", { nom: "X", type: "inexistant" })).error).toBe(true);

    await call("modifier_objet", { id: child.data.id, nom: "Grange nord", emplacement: null });
    expect(await getObject(db, child.data.id)).toMatchObject({ name: "Grange nord", location: null, tags: ["bois"] });

    const loop = await call("deplacer_objet", { id: root.data.id, nouveau_parent_id: child.data.id });
    expect(loop.error).toBe(true);
    const mv = await call("deplacer_objet", { id: child.data.id, nouveau_parent_id: null });
    expect(mv.data.nouveau_parent).toBe("(racine)");
    expect((await getObject(db, child.data.id))?.parentId).toBeNull();
  });

  it("tâches : créer, modifier, terminer (récurrence), lien", async () => {
    const obj = await createObject(db, { name: "Tracteur" });
    const { call } = await connect(true);
    const t = await call("creer_tache", {
      objet_id: obj.id,
      titre: "Vidange",
      description: "Huile **15W40**",
      echeance: "2026-11-01",
      recurrence: "annuelle",
      responsable: "moi",
      heures_estimees: 2,
    });
    expect(t.error).toBe(false);
    expect(await getTodo(db, t.data.id)).toMatchObject({
      title: "Vidange",
      assigneeId: user.id,
      createdById: user.id,
      estHours: 2,
      description: "<p>Huile <strong>15W40</strong></p>",
    });

    expect((await call("creer_tache", { objet_id: obj.id, titre: "x", responsable: "Bob" })).error).toBe(true);
    expect((await call("modifier_tache", { id: t.data.id, objet_id: "00000000-0000-4000-8000-000000000000" })).error).toBe(true);

    await call("modifier_tache", { id: t.data.id, priorite: "haute", responsable: "personne", echeance: null });
    expect(await getTodo(db, t.data.id)).toMatchObject({ priority: "haute", assigneeId: null, dueDate: null });

    const done = await call("modifier_tache", { id: t.data.id, statut: "fait", heures_realisees: 3 });
    expect(done.data.statut).toBe("fait");
    expect(done.data.occurrence_suivante?.id).toBeTruthy();
    expect(await getTodo(db, t.data.id)).toMatchObject({ status: "fait", actualHours: 3 });
    expect((await getTodo(db, done.data.occurrence_suivante.id))?.status).toBe("a_faire");

    expect((await call("ajouter_lien", { objet_id: obj.id, tache_id: t.data.id, url: "https://a.fr" })).error).toBe(true);
    expect((await call("ajouter_lien", { tache_id: t.data.id, url: "javascript:alert(1)" })).error).toBe(true);
    await call("ajouter_lien", { tache_id: t.data.id, url: "https://www.exemple.fr/notice", titre: "Notice" });
    await call("ajouter_lien", { objet_id: obj.id, url: "exemple.fr" });
    expect((await listLinks(db, { todoId: t.data.id })).map((l) => l.title)).toEqual(["Notice"]);
    expect((await listLinks(db, { objectId: obj.id })).map((l) => l.url)).toEqual(["https://exemple.fr/"]);
  });
});
