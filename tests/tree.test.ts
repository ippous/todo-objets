import { describe, expect, it } from "vitest";
import { buildForest, flatten, groupByRoot, nextDueDate, pathTo, subtreeIds, valuePerHour, wouldCreateCycle } from "@/lib/tree";

const objs = [
  { id: "moulin", name: "Le Moulin", parentId: null, position: 0 },
  { id: "annexe", name: "Annexe", parentId: "moulin", position: 1 },
  { id: "sport", name: "Salle de sport", parentId: "annexe", position: 0 },
  { id: "pool", name: "PoolHouse", parentId: "annexe", position: 1 },
  { id: "ferme", name: "La ferme", parentId: "moulin", position: 0 },
  { id: "tracteur", name: "Tracteur", parentId: null, position: 1 },
];

describe("buildForest", () => {
  it("gère plusieurs racines et cumule les statistiques des descendants", () => {
    const stats = new Map([
      ["sport", { openCount: 2, estHours: 3, estValueEur: 100 }],
      ["pool", { openCount: 1, estHours: 1.5, estValueEur: 50 }],
      ["moulin", { openCount: 1, estHours: 2, estValueEur: 0 }],
      ["tracteur", { openCount: 1, estHours: 4, estValueEur: 300 }],
    ]);
    const forest = buildForest(objs, stats);
    expect(forest.map((n) => n.id)).toEqual(["moulin", "tracteur"]);
    const moulin = forest[0];
    expect(moulin.total).toEqual({ openCount: 4, estHours: 6.5, estValueEur: 150 });
    const annexe = moulin.children.find((c) => c.id === "annexe")!;
    expect(annexe.total).toEqual({ openCount: 3, estHours: 4.5, estValueEur: 150 });
    expect(annexe.own.openCount).toBe(0);
    expect(forest[1].total.estValueEur).toBe(300);
  });

  it("trie les frères par position et calcule la profondeur", () => {
    const flat = flatten(buildForest(objs));
    expect(flat.map((n) => `${n.depth}:${n.id}`)).toEqual([
      "0:moulin",
      "1:ferme",
      "1:annexe",
      "2:sport",
      "2:pool",
      "0:tracteur",
    ]);
  });

  it("supporte une profondeur arbitraire", () => {
    const deep = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`,
      name: `N${i}`,
      parentId: i === 0 ? null : `n${i - 1}`,
      position: 0,
    }));
    const stats = new Map([["n49", { openCount: 1, estHours: 1, estValueEur: 1 }]]);
    const [root] = buildForest(deep, stats);
    expect(root.total.openCount).toBe(1);
    expect(flatten([root]).at(-1)!.depth).toBe(49);
  });
});

describe("sous-arbres et boucles", () => {
  it("liste les descendants", () => {
    expect([...subtreeIds(objs, "annexe")].sort()).toEqual(["annexe", "pool", "sport"]);
  });

  it("détecte les déplacements qui créeraient une boucle", () => {
    expect(wouldCreateCycle(objs, "annexe", "sport")).toBe(true);
    expect(wouldCreateCycle(objs, "annexe", "annexe")).toBe(true);
    expect(wouldCreateCycle(objs, "annexe", "tracteur")).toBe(false);
    expect(wouldCreateCycle(objs, "annexe", null)).toBe(false);
  });

  it("donne le chemin depuis la racine", () => {
    expect(pathTo(objs, "pool").map((o) => o.id)).toEqual(["moulin", "annexe", "pool"]);
  });
});

describe("groupByRoot", () => {
  it("regroupe les tâches par objet racine, dans l'ordre de l'arbre", () => {
    const items = [
      { id: "t1", objectId: "tracteur" },
      { id: "t2", objectId: "pool" },
      { id: "t3", objectId: "moulin" },
      { id: "t4", objectId: "sport" },
    ];
    const lanes = groupByRoot(objs, items);
    expect(lanes.map((l) => l.root.id)).toEqual(["moulin", "tracteur"]);
    expect(lanes[0].root.name).toBe("Le Moulin");
    expect(lanes[0].items.map((t) => t.id)).toEqual(["t2", "t3", "t4"]);
    expect(lanes[1].items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("omet les racines sans tâche", () => {
    expect(groupByRoot(objs, [{ objectId: "ferme" }]).map((l) => l.root.id)).toEqual(["moulin"]);
    expect(groupByRoot(objs, [])).toEqual([]);
  });
});

describe("calculs", () => {
  it("valeur par heure", () => {
    expect(valuePerHour(100, 4)).toBe(25);
    expect(valuePerHour(100, 0)).toBeNull();
    expect(valuePerHour(null, 3)).toBeNull();
  });

  it("prochaine échéance des tâches récurrentes", () => {
    expect(nextDueDate("2026-03-15", "2026-03-20", "annuelle")).toBe("2027-03-15");
    expect(nextDueDate("2026-11-30", "2026-12-01", "saisonniere")).toBe("2027-02-28");
    expect(nextDueDate("2026-01-31", "2026-01-31", "mensuelle")).toBe("2026-02-28");
    expect(nextDueDate(null, "2026-10-26", "mensuelle")).toBe("2026-11-26");
    expect(nextDueDate("2026-10-26", "2026-10-26", "aucune")).toBeNull();
  });
});
