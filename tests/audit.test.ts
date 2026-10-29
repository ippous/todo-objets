import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { users, type User } from "@/db/schema";
import { actorOf, describeDetails, listAudit, type Actor } from "@/lib/audit";
import { buildMcpServer } from "@/lib/mcp-server";
import {
  addLink,
  addSubtask,
  createObject,
  createObjects,
  createTodo,
  deleteLink,
  deleteObject,
  deleteTodo,
  moveObject,
  purgeTestData,
  setTodoStatus,
  updateObject,
  updateSubtask,
  updateTodo,
} from "@/lib/repo";
import { createTestDb } from "./helpers";

let db: Db;
let user: User;
let ui: Actor;

beforeEach(async () => {
  db = await createTestDb();
  [user] = await db.insert(users).values({ email: "a@exemple.fr", name: "Alice", role: "admin" }).returning();
  ui = actorOf(user, "interface");
});

const actions = async (f: Parameters<typeof listAudit>[1]) => (await listAudit(db, f)).map((e) => e.action).reverse();

describe("journal des actions", () => {
  it("trace le cycle de vie d'un objet : création, modification, déplacement, suppression", async () => {
    const maison = await createObject(db, { name: "Maison" }, ui);
    const garage = await createObject(db, { name: "Garage" }, ui);
    const atelier = await createObject(db, { name: "Atelier", parentId: maison.id }, ui);
    await updateObject(db, atelier.id, { name: "Atelier bois", typeId: null, description: null, location: "Rez-de-chaussée", tags: ["bois"] }, ui);
    // Enregistrer sans rien changer n'ajoute pas d'entrée
    await updateObject(db, atelier.id, { name: "Atelier bois", typeId: null, description: null, location: "Rez-de-chaussée", tags: ["bois"] }, ui);
    await moveObject(db, atelier.id, garage.id, ui);
    await deleteObject(db, atelier.id, ui);

    const log = await listAudit(db, { objectId: atelier.id });
    expect(log.map((e) => e.action).reverse()).toEqual(["creation", "modification", "deplacement", "suppression"]);
    const [suppression, deplacement, modification, creation] = log;
    expect(creation.details).toEqual({ parent: "Maison" });
    expect(modification.details).toEqual({
      changements: {
        nom: { avant: "Atelier", apres: "Atelier bois" },
        emplacement: { avant: null, apres: "Rez-de-chaussée" },
        tags: { avant: [], apres: ["bois"] },
      },
    });
    expect(describeDetails(deplacement)).toEqual(["De Maison vers Garage"]);
    // L'entrée survit à la suppression, avec le nom au moment de l'action
    expect(suppression).toMatchObject({ entityLabel: "Atelier bois", userName: "Alice", source: "interface", userId: user.id });
  });

  it("trace les tâches : modification avec noms lisibles, statut, occurrence suivante, sous-tâches, liens, suppression", async () => {
    const obj = await createObject(db, { name: "Jardin" }, ui);
    const autre = await createObject(db, { name: "Verger" }, ui);
    const t = await createTodo(db, { objectId: obj.id, title: "Tondre", recurrence: "mensuelle", dueDate: "2026-05-01" }, ui);
    await updateTodo(db, t.id, { objectId: autre.id, assigneeId: user.id, priority: "haute" }, ui);
    const st = await addSubtask(db, t.id, "Affûter la lame", ui);
    await updateSubtask(db, st.id, { done: true }, ui);
    const link = await addLink(db, { owner: { todoId: t.id }, url: "exemple.fr/tondeuse", title: "Notice" }, ui);
    await deleteLink(db, link.id, ui);
    const next = await setTodoStatus(db, t.id, "fait", { actualHours: 2, today: "2026-05-01", actor: ui });
    await deleteTodo(db, t.id, ui);

    expect(await actions({ todoId: t.id })).toEqual([
      "creation",
      "modification",
      "ajout_sous_tache",
      "modification_sous_tache",
      "ajout_lien",
      "suppression_lien",
      "changement_statut",
      "suppression",
    ]);
    const [, statut, , , , , modif] = await listAudit(db, { todoId: t.id });
    expect(describeDetails(modif)).toEqual(["Objet : Jardin → Verger", "Priorité : Moyenne → Haute", "Responsable : — → Alice"]);
    expect(describeDetails(statut)).toEqual(["Statut : À faire → Fait", "Durée réalisée : — → 2 h"]);

    // L'occurrence suivante est tracée comme une création, rattachée à la tâche d'origine
    const [creation] = await listAudit(db, { todoId: next! });
    expect(creation).toMatchObject({ action: "creation", details: { occurrence_de: "Tondre", echeance: "2026-06-01" } });

    // L'historique d'un objet inclut ses tâches
    expect((await listAudit(db, { objectId: autre.id })).some((e) => e.entityId === t.id && e.action === "suppression")).toBe(true);
  });

  it("sans auteur (scripts, tests), rien n'est enregistré", async () => {
    const obj = await createObject(db, { name: "Cabane" });
    await createTodo(db, { objectId: obj.id, title: "Repeindre" });
    expect(await listAudit(db)).toEqual([]);
  });

  it("pagine sans perdre les entrées créées dans la même transaction", async () => {
    await createObjects(db, null, Array.from({ length: 7 }, (_, i) => `Lot ${i}`), {}, ui);
    const first = await listAudit(db, { limit: 4 });
    const rest = await listAudit(db, { limit: 4, afterId: first[3].id });
    expect(rest).toHaveLength(3);
    expect(new Set([...first, ...rest].map((e) => e.entityLabel)).size).toBe(7);
  });

  it("la purge des données de test efface aussi leur journal", async () => {
    const obj = await createObject(db, { name: "zz-test Hangar" }, ui);
    await createTodo(db, { objectId: obj.id, title: "Ranger" }, ui);
    const keep = await createObject(db, { name: "Grange" }, ui);
    await purgeTestData(db, "zz-test");
    expect((await listAudit(db)).map((e) => e.entityId)).toEqual([keep.id]);
  });
});

describe("journal — MCP", () => {
  async function connect(client: string) {
    const server = buildMcpServer(db, user, "https://carnet.test", true, client);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "test", version: "1" });
    await c.connect(b);
    return async (name: string, args: Record<string, unknown>) => {
      const r = await c.callTool({ name, arguments: args });
      return JSON.parse((r.content as { text: string }[])[0].text);
    };
  }

  it("les écritures MCP sont tracées avec l'origine « mcp » et le nom de l'application", async () => {
    const call = await connect("Claude");
    const o = await call("creer_objet", { nom: "Puits" });
    const t = await call("creer_tache", { objet_id: o.id, titre: "Curer", statut: "fait" });
    await call("modifier_tache", { id: t.id, priorite: "basse" });

    const log = await listAudit(db, { objectId: o.id });
    expect(log.every((e) => e.source === "mcp" && e.client === "Claude" && e.userName === "Alice")).toBe(true);
    expect(log.map((e) => e.action).reverse()).toEqual(["creation", "creation", "changement_statut", "modification"]);

    const h = await call("consulter_historique", { tache_id: t.id });
    expect(h.entrees[0]).toMatchObject({ origine: "mcp", application: "Claude", auteur: "Alice", action: "modification" });
    expect(h.entrees[0].details).toEqual(["Priorité : Moyenne → Basse"]);
  });
});
