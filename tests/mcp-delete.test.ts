import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { users, type User } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp-server";
import { addLink, createObject, createTodo, getObject, getTodo, listDocuments, listLinks, listPhotos, listSubtasks, listTypes } from "@/lib/repo";
import { exists, remove } from "@/lib/storage";
import { createTestDb } from "./helpers";

let db: Db;
let user: User;

beforeEach(async () => {
  db = await createTestDb();
  [user] = await db.insert(users).values({ email: "a@exemple.fr", name: "Alice", role: "admin" }).returning();
});

type Content = { type: string; text?: string; data?: string; mimeType?: string; resource?: { blob?: string; mimeType?: string } };

async function connect(write: boolean, del = false) {
  const server = buildMcpServer(db, user, "https://carnet.test", write, "test", del);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const raw = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await raw(name, args);
    const text = (r.content as Content[])[0].text!;
    return { error: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call, raw };
}

const DELETE_TOOLS = ["supprimer_tache", "supprimer_objet", "supprimer_sous_tache", "supprimer_photo", "supprimer_document", "supprimer_lien"];
const NEW_WRITE_TOOLS = ["ajouter_document", "modifier_document", "ajouter_sous_taches", "modifier_sous_tache", "creer_type", "modifier_photo", "modifier_lien"];

describe("MCP — droits de suppression", () => {
  it("écriture seule : nouveaux outils d'écriture, aucun de suppression ; lecture : voir_photo / lire_document", async () => {
    const names = (await (await connect(true)).client.listTools()).tools.map((t) => t.name);
    for (const n of NEW_WRITE_TOOLS) expect(names).toContain(n);
    for (const n of DELETE_TOOLS) expect(names).not.toContain(n);
    const ro = (await (await connect(false)).client.listTools()).tools.map((t) => t.name);
    expect(ro).toEqual(expect.arrayContaining(["voir_photo", "lire_document"]));
    for (const n of NEW_WRITE_TOOLS) expect(ro).not.toContain(n);
  });

  it("suppression : outils présents et marqués destructifs (et l'écriture aussi)", async () => {
    const tools = (await (await connect(false, true)).client.listTools()).tools;
    for (const n of DELETE_TOOLS) expect(tools.find((t) => t.name === n)?.annotations?.destructiveHint).toBe(true);
    expect(tools.map((t) => t.name)).toContain("creer_tache");
  });
});

describe("MCP — documents", () => {
  it("ajoute (base64), décrit, lit, change de type, puis supprime", async () => {
    const obj = await createObject(db, { name: "Chaudière" });
    const { call, raw } = await connect(true, true);
    const files: string[] = [];
    try {
      expect((await call("ajouter_document", { objet_id: obj.id, fichier_base64: "aGVsbG8=" })).error).toBe(true); // nom manquant
      expect((await call("ajouter_document", { objet_id: obj.id, nom_fichier: "x.exe", fichier_base64: "aGVsbG8=" })).error).toBe(true);
      expect((await call("ajouter_document", { objet_id: obj.id, nom_fichier: "a.txt", fichier_base64: "aGVsbG8=", type_document: "Inconnu" })).error).toBe(true);

      const r = await call("ajouter_document", {
        objet_id: obj.id,
        nom_fichier: "notice.md",
        fichier_base64: Buffer.from("# Notice\nPurger le circuit.").toString("base64"),
        description: "Notice d'entretien",
      });
      expect(r.error).toBe(false);
      expect(r.data).toMatchObject({ nom: "notice.md", format: "Markdown", description: "Notice d'entretien" });
      const [doc] = await listDocuments(db, { objectId: obj.id });
      files.push(doc.pathname);
      expect(await exists(doc.pathname)).toBe(true);

      const fiche = await call("obtenir_objet", { id: obj.id });
      expect(fiche.data.documents[0]).toMatchObject({ id: doc.id, description: "Notice d'entretien" });

      const lu = await raw("lire_document", { id: doc.id });
      expect((lu.content as Content[])[1].text).toContain("Purger le circuit");

      const types = await listTypes(db, "document");
      const autre = types.find((t) => t.name !== doc.typeName)!;
      const m = await call("modifier_document", { id: doc.id, type_document: autre.name, description: null });
      expect(m.data).toMatchObject({ type: autre.name, description: null });

      const s = await call("supprimer_document", { id: doc.id });
      expect(s.data.supprime).toBe(true);
      expect(await listDocuments(db, { objectId: obj.id })).toHaveLength(0);
      expect(await exists(doc.pathname)).toBe(false);
    } finally {
      await remove(files);
    }
  });

  it("refuse url_source non https", async () => {
    const obj = await createObject(db, { name: "Pompe" });
    const { call } = await connect(true);
    const r = await call("ajouter_document", { objet_id: obj.id, url_source: "http://exemple.fr/a.pdf" });
    expect(r.error).toBe(true);
    expect(r.text).toContain("https");
  });
});

describe("MCP — photos : description, lecture, suppression", () => {
  it("légende à l'ajout, modification, voir_photo, suppression", async () => {
    const obj = await createObject(db, { name: "Grange" });
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#996633" } }).png().toBuffer();
    const { call, raw } = await connect(true, true);
    const files: string[] = [];
    try {
      const r = await call("ajouter_photo", { image_base64: png.toString("base64"), objet_ids: [obj.id], description: "Façade nord" });
      expect(r.error).toBe(false);
      const [p] = await listPhotos(db, { objectId: obj.id });
      files.push(p.pathname, p.thumbPathname);
      expect(p.description).toBe("Façade nord");

      const fiche = await call("obtenir_objet", { id: obj.id });
      expect(fiche.data.photos).toEqual([expect.objectContaining({ id: p.id, description: "Façade nord", vignette: true })]);

      expect((await call("modifier_photo", { id: p.id, description: "Façade nord, avant travaux" })).data.description).toBe("Façade nord, avant travaux");

      const vue = await raw("voir_photo", { id: p.id });
      const [img, meta] = vue.content as Content[];
      expect(img).toMatchObject({ type: "image", mimeType: "image/jpeg" });
      expect(Buffer.from(img.data!, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
      expect(meta.text).toContain("avant travaux");

      expect((await call("supprimer_photo", { id: p.id })).data.supprime).toBe(true);
      expect(await listPhotos(db, { objectId: obj.id })).toHaveLength(0);
      expect(await exists(p.pathname)).toBe(false);
    } finally {
      await remove(files);
    }
  });
});

describe("MCP — sous-tâches, types, suppressions", () => {
  it("sous-tâches : ajout en lot, modification, suppression", async () => {
    const obj = await createObject(db, { name: "Tracteur" });
    const t = await createTodo(db, { objectId: obj.id, title: "Révision", createdById: user.id });
    const { call } = await connect(true, true);
    const r = await call("ajouter_sous_taches", {
      tache_id: t.id,
      sous_taches: [{ texte: "Vidange", heures_estimees: 1 }, { texte: "Filtre à air", faite: true }],
    });
    expect(r.data.ajoutees).toBe(2);
    let subs = await listSubtasks(db, t.id);
    expect(subs.map((s) => [s.title, s.done])).toEqual([["Vidange", false], ["Filtre à air", true]]);
    const fiche = await call("obtenir_tache", { id: t.id });
    expect(fiche.data.sous_taches[0].id).toBe(subs[0].id);

    await call("modifier_sous_tache", { id: subs[0].id, faite: true, heures_realisees: 1.5 });
    expect((await listSubtasks(db, t.id))[0]).toMatchObject({ done: true, actualHours: 1.5 });

    await call("supprimer_sous_tache", { id: subs[1].id });
    subs = await listSubtasks(db, t.id);
    expect(subs).toHaveLength(1);
    expect((await call("supprimer_sous_tache", { id: subs[1]?.id ?? "00000000-0000-4000-8000-000000000000" })).error).toBe(true);
  });

  it("creer_type : objet, document, tâche ; doublon refusé ; utilisable ensuite", async () => {
    const { call } = await connect(true);
    expect((await call("creer_type", { categorie: "objet", nom: "Serre" })).data.nom).toBe("Serre");
    expect((await call("creer_type", { categorie: "objet", nom: "serre" })).error).toBe(true);
    expect((await call("creer_type", { categorie: "document", nom: "Devis", icone: "wifi" })).error).toBe(true);
    expect((await call("creer_type", { categorie: "tache", nom: "Semis" })).error).toBe(false);
    const o = await call("creer_objet", { nom: "Tunnel", type: "Serre" });
    expect(o.error).toBe(false);
    const obj = await getObject(db, o.data.id);
    expect(obj?.type).toBe("Serre");
  });

  it("supprime tâche, lien, objet (refusé tant qu'il a des tâches)", async () => {
    const obj = await createObject(db, { name: "Remorque" });
    const t = await createTodo(db, { objectId: obj.id, title: "Pneus", createdById: user.id });
    const l = await addLink(db, { owner: { objectId: obj.id }, url: "https://exemple.fr" });
    const { call } = await connect(true, true);

    const fiche = await call("obtenir_objet", { id: obj.id });
    expect(fiche.data.liens[0].id).toBe(l.id);
    expect((await call("supprimer_lien", { id: l.id })).data.supprime).toBe(true);
    expect(await listLinks(db, { objectId: obj.id })).toHaveLength(0);

    const refus = await call("supprimer_objet", { id: obj.id });
    expect(refus.error).toBe(true);
    expect(refus.text).toContain("tâches");

    expect((await call("supprimer_tache", { id: t.id })).data.titre).toBe("Pneus");
    expect(await getTodo(db, t.id)).toBeUndefined();
    expect((await call("supprimer_objet", { id: obj.id })).data.supprime).toBe(true);
    expect(await getObject(db, obj.id)).toBeUndefined();
  });
});
