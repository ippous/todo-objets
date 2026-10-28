import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { BulkAddButton } from "@/components/bulk-add";
import { ObjectSearch } from "@/components/object-search";
import { TreeView, type TreeViewNode } from "@/components/tree-view";
import { fmtEur, fmtHours } from "@/lib/format";
import { listObjects, listTypes, listUsers, objectCovers, openStatsByObject, todoCountByObject } from "@/lib/repo";
import { buildForest, emptyStats, type TreeNode } from "@/lib/tree";
import type { ObjectRow } from "@/db/schema";

export const metadata: Metadata = { title: "Arbre" };

function toView(n: TreeNode<ObjectRow>, counts: Map<string, number>, covers: Map<string, string>): TreeViewNode {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    depth: n.depth,
    total: n.total,
    todoCount: counts.get(n.id) ?? 0,
    coverId: covers.get(n.id) ?? null,
    children: n.children.map((c) => toView(c, counts, covers)),
  };
}

export default async function ArbrePage() {
  const db = getDb();
  const [objs, stats, counts, covers, users, objectTypes] = await Promise.all([
    listObjects(db),
    openStatsByObject(db),
    todoCountByObject(db),
    objectCovers(db),
    listUsers(db),
    listTypes(db, "objet"),
  ]);
  const activeUsers = users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
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
          <p className="hidden text-sm text-muted sm:block">
            Glisse un objet sur un autre pour le déplacer, ou utilise le menu « … » de chaque ligne.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/objets/nouveau" className="btn btn-ghost">
            Nouvel objet racine
          </Link>
          <BulkAddButton
            target={{ kind: "objets", parentId: null, parentName: null }}
            objectTypes={objectTypes}
            label="Plusieurs objets racines"
          />
        </div>
      </div>

      {forest.length > 0 && (
        <search aria-label="Rechercher un objet">
          <ObjectSearch />
        </search>
      )}

      {forest.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-6">
          <p className="font-bold">Aucun objet pour l&apos;instant.</p>
          <p className="text-muted">
            Crée une première racine (une propriété, un véhicule, un projet…), puis ajoute-lui des sous-objets.
          </p>
        </div>
      ) : (
        <section aria-label="Arborescences" className="rounded-xl bg-surface p-3 sm:p-5">
          <TreeView forest={forest.map((n) => toView(n, counts, covers))} users={activeUsers} objectTypes={objectTypes} />
        </section>
      )}
    </div>
  );
}
