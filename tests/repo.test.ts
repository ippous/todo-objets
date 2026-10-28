import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import {
  computeTotals,
  createObject,
  createTodo,
  createUser,
  deleteObject,
  DomainError,
  listObjects,
  listTodos,
  moveObject,
  openStatsByObject,
  searchObjects,
  setTodoStatus,
  subtreeIdsDb,
  updateUser,
} from "@/lib/repo";
import { seedInitialTree } from "@/lib/seed";
import { buildForest } from "@/lib/tree";
import { createTestDb } from "./helpers";

let db: Db;
const ids: Record<string, string> = {};

beforeEach(async () => {
  db = await createTestDb();
  await seedInitialTree(db);
  for (const o of await listObjects(db)) ids[o.name] = o.id;
});

describe("arborescence en base", () => {
  it("crée l'arbre initial une seule fois", async () => {
    expect(Object.keys(ids)).toHaveLength(8);
    expect(await seedInitialTree(db)).toBe(false);
  });

  it("retrouve tous les descendants par requête récursive", async () => {
    const sub = await subtreeIdsDb(db, ids["Annexe"]);
    expect(sub.sort()).toEqual([ids["Annexe"], ids["PoolHouse"], ids["Salle de sport"]].sort());
    expect(await subtreeIdsDb(db, ids["Le Moulin FRat"])).toHaveLength(8);
  });

  it("déplace un sous-arbre complet", async () => {
    const { typeIdByName } = await import("@/lib/repo");
    const tracteur = await createObject(db, { name: "Tracteur", typeId: await typeIdByName(db, "objet", "véhicule") });
    await moveObject(db, ids["Annexe"], tracteur.id);
    const sub = await subtreeIdsDb(db, tracteur.id);
    expect(sub).toContain(ids["PoolHouse"]);
    expect(await subtreeIdsDb(db, ids["Le Moulin FRat"])).toHaveLength(5);
  });

  it("refuse un déplacement qui créerait une boucle", async () => {
    await expect(moveObject(db, ids["Annexe"], ids["PoolHouse"])).rejects.toBeInstanceOf(DomainError);
    await expect(moveObject(db, ids["Annexe"], ids["Annexe"])).rejects.toBeInstanceOf(DomainError);
    await expect(moveObject(db, ids["Le Moulin FRat"], ids["Salle de sport"])).rejects.toBeInstanceOf(DomainError);
  });

  it("permet de remonter un objet en racine", async () => {
    await moveObject(db, ids["Annexe"], null);
    const forest = buildForest(await listObjects(db));
    expect(forest.map((n) => n.name).sort()).toEqual(["Annexe", "Le Moulin FRat"]);
  });

  it("protège la suppression d'un objet non vide", async () => {
    await expect(deleteObject(db, ids["Annexe"])).rejects.toBeInstanceOf(DomainError);
    await createTodo(db, { objectId: ids["PoolHouse"], title: "Nettoyer le filtre" });
    await expect(deleteObject(db, ids["PoolHouse"])).rejects.toBeInstanceOf(DomainError);
    await deleteObject(db, ids["Prairies"]);
    expect(await listObjects(db)).toHaveLength(7);
  });
});

describe("tâches", () => {
  it("liste les tâches d'un objet et de tous ses descendants, avec cumuls", async () => {
    await createTodo(db, { objectId: ids["PoolHouse"], title: "Filtre", estHours: 2, estValueEur: 100 });
    await createTodo(db, { objectId: ids["Salle de sport"], title: "Miroir", estHours: 1, estValueEur: 30 });
    await createTodo(db, { objectId: ids["La ferme"], title: "Gouttières", estHours: 4, estValueEur: 400 });

    const annexe = await listTodos(db, { subtreeOf: ids["Annexe"] });
    expect(annexe.map((t) => t.title).sort()).toEqual(["Filtre", "Miroir"]);

    const forest = buildForest(await listObjects(db), await openStatsByObject(db));
    const moulin = forest[0];
    expect(moulin.total).toEqual({ openCount: 3, estHours: 7, estValueEur: 530 });
    expect(moulin.children.find((c) => c.name === "Annexe")!.total.estValueEur).toBe(130);
  });

  it("filtre par statut, tag, responsable et trie par ratio €/h", async () => {
    const eric = await createUser(db, { email: "Eric@Example.com", name: "Eric", role: "admin" });
    await createTodo(db, { objectId: ids["Carrière"], title: "A", estHours: 10, estValueEur: 100, tags: ["chevaux"] });
    await createTodo(db, { objectId: ids["Carrière"], title: "B", estHours: 1, estValueEur: 50, assigneeId: eric.id });
    await createTodo(db, { objectId: ids["Carrière"], title: "C" });

    const byRatio = await listTodos(db, {}, "ratio");
    expect(byRatio.map((t) => t.title)).toEqual(["B", "A", "C"]);
    expect(byRatio[0].valuePerHour).toBe(50);
    expect(byRatio[0].assigneeName).toBe("Eric");

    expect((await listTodos(db, { tag: "chevaux" })).map((t) => t.title)).toEqual(["A"]);
    expect((await listTodos(db, { assigneeId: eric.id })).map((t) => t.title)).toEqual(["B"]);
    expect((await listTodos(db, { assigneeId: "none" })).map((t) => t.title).sort()).toEqual(["A", "C"]);
    expect((await listTodos(db, { q: "b" })).map((t) => t.title)).toEqual(["B"]);
  });

  it("enregistre le réalisé et crée une seule fois l'occurrence suivante", async () => {
    const t = await createTodo(db, {
      objectId: ids["Prairies"],
      title: "Faucher",
      estHours: 6,
      dueDate: "2026-06-15",
      recurrence: "annuelle",
    });
    const nextId = await setTodoStatus(db, t.id, "fait", { actualHours: 7, actualValueEur: 0 }, "2026-06-20");
    expect(nextId).toBeTruthy();
    const all = await listTodos(db, { subtreeOf: ids["Prairies"] });
    const next = all.find((x) => x.id === nextId)!;
    expect(next.dueDate).toBe("2027-06-15");
    expect(next.status).toBe("a_faire");
    const done = all.find((x) => x.id === t.id)!;
    expect(done.actualHours).toBe(7);
    expect(done.doneAt).toBeTruthy();

    // Rouvrir puis refermer ne recrée pas d'occurrence
    await setTodoStatus(db, t.id, "a_faire");
    expect(await setTodoStatus(db, t.id, "fait")).toBeNull();
    expect(await listTodos(db, { subtreeOf: ids["Prairies"] })).toHaveLength(2);

    const totals = computeTotals(await listTodos(db, { subtreeOf: ids["Prairies"] }));
    expect(totals.done).toMatchObject({ count: 1, actualHours: 7, estHours: 6 });
    expect(totals.open.openCount).toBe(1);
  });
});

describe("utilisateurs", () => {
  it("normalise les adresses et garde au moins un administrateur", async () => {
    const admin = await createUser(db, { email: " Admin@X.fr ", name: "Admin", role: "admin" });
    expect(admin.email).toBe("admin@x.fr");
    await expect(createUser(db, { email: "admin@x.fr", name: "Doublon" })).rejects.toBeInstanceOf(DomainError);
    await expect(updateUser(db, admin.id, { role: "membre" })).rejects.toBeInstanceOf(DomainError);
    await expect(updateUser(db, admin.id, { active: false })).rejects.toBeInstanceOf(DomainError);
    const other = await createUser(db, { email: "b@x.fr", name: "B", role: "admin" });
    await updateUser(db, admin.id, { role: "membre" });
    await expect(updateUser(db, other.id, { role: "membre" })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("ajout en lot", () => {
  it("crée plusieurs sous-objets dans l'ordre, après les frères existants", async () => {
    const { createObjects, typeIdByName } = await import("@/lib/repo");
    const piece = await typeIdByName(db, "objet", "pièce");
    const created = await createObjects(db, ids["Annexe"], [" Vestiaire ", "", "Sauna", "Douches"], { typeId: piece });
    expect(created.map((o) => o.name)).toEqual(["Vestiaire", "Sauna", "Douches"]);
    expect(created.every((o) => o.typeId === piece && o.parentId === ids["Annexe"])).toBe(true);
    const positions = created.map((o) => o.position);
    expect(positions[0]).toBeGreaterThan(1); // Salle de sport (0) et PoolHouse (1) existent déjà
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    const roots = await createObjects(db, null, ["Tracteur", "Quad"]);
    expect(roots.every((o) => o.parentId === null)).toBe(true);
  });

  it("refuse une liste vide, trop longue, ou un parent inconnu", async () => {
    const { createObjects, BULK_MAX } = await import("@/lib/repo");
    await expect(createObjects(db, null, ["  ", ""])).rejects.toBeInstanceOf(DomainError);
    await expect(createObjects(db, null, Array.from({ length: BULK_MAX + 1 }, (_, i) => `O${i}`))).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(createObjects(db, "00000000-0000-0000-0000-000000000000", ["X"])).rejects.toBeInstanceOf(DomainError);
    expect(await listObjects(db)).toHaveLength(8);
  });

  it("crée plusieurs tâches avec des réglages communs", async () => {
    const { createTodos } = await import("@/lib/repo");
    const created = await createTodos(db, ids["La ferme"], ["Gouttières", "Volets", "Cheminée"], {
      category: "travaux",
      priority: "haute",
      dueDate: "2026-12-01",
    });
    expect(created).toHaveLength(3);
    const list = await listTodos(db, { subtreeOf: ids["La ferme"] });
    expect(list.every((t) => t.category === "travaux" && t.priority === "haute" && t.dueDate === "2026-12-01")).toBe(true);
  });
});

describe("recherche d'objets", () => {
  it("ignore casse et accents, classe les noms qui commencent par le texte en premier", async () => {
    await createObject(db, { name: "Pré du bas", parentId: ids["Prairies"], typeId: null });
    const { hits, total } = await searchObjects(db, "PRE");
    expect(total).toBe(1);
    expect(hits[0]).toMatchObject({ name: "Pré du bas", path: "Le Moulin FRat › Prairies" });

    await createObject(db, { name: "Abri", location: "près de la ferme", typeId: null });
    const ferme = await searchObjects(db, "ferme");
    expect(ferme.hits.map((h) => h.name)).toEqual(["La ferme", "Abri"]);
  });

  it("cherche dans le type, les tags et le texte de la description", async () => {
    await createObject(db, { name: "Puits", tags: ["eau"], description: "<p>Pompe <strong>immergée</strong></p>", typeId: null });
    expect((await searchObjects(db, "pompe immergee")).hits.map((h) => h.name)).toEqual(["Puits"]);
    expect((await searchObjects(db, "eau")).hits.map((h) => h.name)).toContain("Puits");
    expect((await searchObjects(db, "strong")).total).toBe(0);
    expect((await searchObjects(db, "pièce")).hits.map((h) => h.name).sort()).toEqual(["PoolHouse", "Salle de sport"]);
    expect(await searchObjects(db, "   ")).toEqual({ hits: [], total: 0 });
  });

  it("limite le nombre de résultats mais donne le total", async () => {
    const r = await searchObjects(db, "a", 2);
    expect(r.hits).toHaveLength(2);
    expect(r.total).toBeGreaterThan(2);
  });
});
