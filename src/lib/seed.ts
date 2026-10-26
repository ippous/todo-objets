import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { objects } from "@/db/schema";

type SeedNode = { name: string; type: string; children?: SeedNode[] };

export const INITIAL_TREE: SeedNode[] = [
  {
    name: "Le Moulin FRat",
    type: "propriété",
    children: [
      { name: "Prairies", type: "terrain" },
      { name: "La ferme", type: "bâtiment" },
      { name: "Carrière", type: "terrain" },
      { name: "Pâtures", type: "terrain" },
      {
        name: "Annexe",
        type: "bâtiment",
        children: [
          { name: "Salle de sport", type: "pièce" },
          { name: "PoolHouse", type: "pièce" },
        ],
      },
    ],
  },
];

/** Crée l'arborescence de départ si la table des objets est vide. */
export async function seedInitialTree(db: Db, tree: SeedNode[] = INITIAL_TREE): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(objects);
  if (Number(count) > 0) return false;
  const insert = async (nodes: SeedNode[], parentId: string | null) => {
    for (const [i, n] of nodes.entries()) {
      const [row] = await db
        .insert(objects)
        .values({ name: n.name, type: n.type, parentId, position: i })
        .returning({ id: objects.id });
      if (n.children) await insert(n.children, row.id);
    }
  };
  await insert(tree, null);
  return true;
}
