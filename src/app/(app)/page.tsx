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

function toView(
  n: TreeNode<ObjectRow>,
  counts: Map<string, number>,
  covers: Map<string, string>,
  baseDepth = 0,
): TreeViewNode {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    depth: n.depth - baseDepth,
    total: n.total,
    todoCount: counts.get(n.id) ?? 0,
    coverId: covers.get(n.id) ?? null,
    children: n.children.map((c) => toView(c, counts, covers, baseDepth)),
  };
}

function findInForest(forest: TreeNode<ObjectRow>[], id: string): TreeNode<ObjectRow> | null {
  for (const n of forest) {
    if (n.id === id) return n;
    const f = findInForest(n.children, id);
    if (f) return f;
  }
  return null;
}

export default async function ArbrePage(props: PageProps<"/">) {
  const sp = await props.searchParams;
  const racineId = typeof sp.racine === "string" ? sp.racine : "";
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
  const fullForest = buildForest(objs, stats);
  // Affichage recentré sur un objet (?racine=<id>) : seul son sous-arbre est montré
  const focus = racineId ? findInForest(fullForest, racineId) : null;
  const forest = focus ? [focus] : fullForest;
  const byId = new Map(objs.map((o) => [o.id, o]));
  const ancestors: ObjectRow[] = [];
  for (let p = focus?.parentId ? byId.get(focus.parentId) : undefined; p && ancestors.length < 100; ) {
    ancestors.unshift(p);
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
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

      {racineId && !focus && (
        <p role="status" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
          Cet objet n&apos;existe plus : l&apos;arbre complet est affiché.
        </p>
      )}

      {focus && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-moss bg-moss-soft px-3 py-2">
          <nav aria-label="Racine affichée" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-sm">
            <span className="text-muted">Affiché depuis :</span>
            {ancestors.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5">
                <Link href={`/?racine=${a.id}`} className="underline underline-offset-4">
                  {a.name}
                </Link>
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </span>
            ))}
            <span className="font-bold" aria-current="page">
              {focus.name}
            </span>
          </nav>
          <Link href="/" className="btn btn-ghost min-h-9 px-3 text-sm">
            Revenir à l&apos;arbre complet
          </Link>
        </div>
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
          <TreeView
            forest={forest.map((n) => toView(n, counts, covers, focus?.depth ?? 0))}
            focusId={focus?.id ?? null}
            users={activeUsers}
            objectTypes={objectTypes}
          />
        </section>
      )}
    </div>
  );
}
