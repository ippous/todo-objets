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
    const tracteur = await createObject(db, { name: "Tracteur", type: "véhicule" });
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
