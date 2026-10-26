"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtEur, fmtHours } from "@/lib/format";
import type { Stats } from "@/lib/tree";

export type TreeViewNode = {
  id: string;
  name: string;
  type: string | null;
  depth: number;
  own: Stats;
  total: Stats;
  children: TreeViewNode[];
};

const STORAGE_KEY = "carnet:arbre-ferme";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    /* stockage indisponible : l'état n'est simplement pas mémorisé */
  }
}

export function TreeView({ forest }: { forest: TreeViewNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture du stockage local après hydratation
    setCollapsed(loadCollapsed());
  }, []);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });

  return (
    <ul className="tree grid gap-0.5">
      {forest.map((n) => (
        <TreeItem key={n.id} node={n} collapsed={collapsed} toggle={toggle} />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  collapsed,
  toggle,
}: {
  node: TreeViewNode;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(node.id);
  const t = node.total;
  return (
    <li>
      <div className="flex min-h-12 items-start gap-1 py-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Replier" : "Déplier"} ${node.name}`}
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-moss-soft"
          >
            <svg viewBox="0 0 16 16" className={`size-4 transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
              <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center" aria-hidden>
            <span className="size-1.5 rounded-full bg-branch" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1">
          <Link
            href={`/objets/${node.id}`}
            className={`underline-offset-4 hover:underline ${node.depth === 0 ? "text-lg font-bold" : "font-bold"}`}
          >
            {node.name}
          </Link>
          {node.type && <span className="text-sm text-muted">{node.type}</span>}
          <span className="num ml-auto flex gap-3 text-sm text-muted">
            {t.openCount > 0 ? (
              <>
                <span className="font-bold text-ink">
                  {t.openCount} tâche{t.openCount > 1 ? "s" : ""}
                </span>
                {t.estHours > 0 && <span>{fmtHours(t.estHours)}</span>}
                {t.estValueEur > 0 && <span>{fmtEur(t.estValueEur)}</span>}
              </>
            ) : (
              <span>rien à faire</span>
            )}
          </span>
        </div>
      </div>
      {hasChildren && isOpen && (
        <ul className="grid gap-0.5">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} collapsed={collapsed} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}
