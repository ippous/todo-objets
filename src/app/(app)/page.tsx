import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { TreeView, type TreeViewNode } from "@/components/tree-view";
import { fmtEur, fmtHours } from "@/lib/format";
import { listObjects, openStatsByObject } from "@/lib/repo";
import { buildForest, emptyStats, type TreeNode } from "@/lib/tree";
import type { ObjectRow } from "@/db/schema";

export const metadata: Metadata = { title: "Arbre" };

function toView(n: TreeNode<ObjectRow>): TreeViewNode {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    depth: n.depth,
    own: n.own,
    total: n.total,
    children: n.children.map(toView),
  };
}

export default async function ArbrePage() {
  const db = getDb();
  const [objs, stats] = await Promise.all([listObjects(db), openStatsByObject(db)]);
  const forest = buildForest(objs, stats);
  const all = forest.reduce(
    (acc, r) => ({
      openCount: acc.openCount + r.total.openCount,
      estHours: acc.estHours + r.total.estHours,
      estValueEur: acc.estValueEur + r.total.estValueEur,
    }),
    emptyStats(),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Arbre des objets</h1>
          <p className="num text-muted">
            {all.openCount} tâche{all.openCount > 1 ? "s" : ""} ouverte{all.openCount > 1 ? "s" : ""} ·{" "}
            {fmtHours(Math.round(all.estHours * 100) / 100)} · {fmtEur(Math.round(all.estValueEur * 100) / 100)}
          </p>
        </div>
        <Link href="/objets/nouveau" className="btn btn-ghost">
          Nouvel objet racine
        </Link>
      </div>

      {forest.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6">
          <p className="font-bold">Aucun objet pour l&apos;instant.</p>
          <p className="text-muted">
            Crée une première racine (une propriété, un véhicule, un projet…), puis ajoute-lui des sous-objets.
          </p>
        </div>
      ) : (
        <section aria-label="Arborescences" className="rounded-xl bg-surface p-3 sm:p-5">
          <TreeView forest={forest.map(toView)} />
        </section>
      )}
    </div>
  );
}
