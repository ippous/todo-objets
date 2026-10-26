"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteObjectInlineAction, moveObjectInlineAction } from "@/app/actions";
import { fmtEur, fmtHours } from "@/lib/format";
import type { Stats } from "@/lib/tree";

export type TreeViewNode = {
  id: string;
  name: string;
  type: string | null;
  depth: number;
  total: Stats;
  todoCount: number;
  coverId: string | null;
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

function findNode(forest: TreeViewNode[], id: string): TreeViewNode | null {
  for (const n of forest) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}

function subtree(node: TreeViewNode | null): Set<string> {
  const s = new Set<string>();
  const walk = (n: TreeViewNode) => {
    s.add(n.id);
    n.children.forEach(walk);
  };
  if (node) walk(node);
  return s;
}

type Ctx = {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  moving: TreeViewNode | null;
  blocked: Set<string>;
  dragging: string | null;
  dropTarget: string | null;
  setDragging: (id: string | null) => void;
  setDropTarget: (id: string | null) => void;
  startMove: (n: TreeViewNode) => void;
  moveTo: (id: string, parentId: string | null) => void;
  remove: (n: TreeViewNode) => void;
  menuOpen: string | null;
  setMenuOpen: (id: string | null) => void;
  pending: boolean;
};

export function TreeView({ forest }: { forest: TreeViewNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture du stockage local après hydratation
    setCollapsed(loadCollapsed());
  }, []);

  const moving = movingId ? findNode(forest, movingId) : null;
  const activeId = dragging ?? movingId;
  const blocked = useMemo(() => subtree(activeId ? findNode(forest, activeId) : null), [forest, activeId]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });

  const moveTo = (id: string, parentId: string | null) => {
    const node = findNode(forest, id);
    const target = parentId ? findNode(forest, parentId) : null;
    setMovingId(null);
    setDragging(null);
    setDropTarget(null);
    start(async () => {
      const r = await moveObjectInlineAction(id, parentId);
      if (r.error) setMessage({ kind: "error", text: r.error });
      else {
        setMessage({ kind: "ok", text: `« ${node?.name} » est maintenant ${target ? `sous « ${target.name} »` : "une racine"}.` });
        if (parentId && collapsed.has(parentId)) toggle(parentId);
      }
    });
  };

  const remove = (n: TreeViewNode) => {
    setMenuOpen(null);
    start(async () => {
      const r = await deleteObjectInlineAction(n.id);
      setMessage(r.error ? { kind: "error", text: r.error } : { kind: "ok", text: `« ${n.name} » a été supprimé.` });
    });
  };

  const ctx: Ctx = {
    collapsed,
    toggle,
    moving,
    blocked,
    dragging,
    dropTarget,
    setDragging,
    setDropTarget,
    startMove: (n) => {
      setMenuOpen(null);
      setMessage(null);
      setMovingId(n.id);
    },
    moveTo,
    remove,
    menuOpen,
    setMenuOpen,
    pending,
  };

  return (
    <div className="grid gap-3">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${
            message.kind === "error" ? "bg-brick-soft text-brick" : "bg-moss-soft text-moss"
          }`}
        >
          {message.text}
        </p>
      )}

      {moving && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-moss bg-surface p-3 shadow-md">
          <p className="flex-1 font-bold">Où placer « {moving.name} » ? Choisis son nouveau parent.</p>
          {moving && (
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => moveTo(moving.id, null)}>
              En faire une racine
            </button>
          )}
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setMovingId(null)}>
            Annuler
          </button>
        </div>
      )}

      {dragging && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDropTarget("__racine__");
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            moveTo(dragging, null);
          }}
          className={`fixed inset-x-4 bottom-6 z-40 mx-auto max-w-md rounded-xl border-2 border-dashed p-4 text-center text-sm shadow-lg ${
            dropTarget === "__racine__" ? "border-moss bg-moss-soft text-moss" : "border-line bg-surface text-muted"
          }`}
        >
          Déposer ici pour en faire une racine
        </div>
      )}

      <ul className={`tree grid gap-0.5 ${pending ? "opacity-70" : ""}`} aria-busy={pending}>
        {forest.map((n) => (
          <TreeItem key={n.id} node={n} ctx={ctx} />
        ))}
      </ul>
    </div>
  );
}

function TreeItem({ node, ctx }: { node: TreeViewNode; ctx: Ctx }) {
  const hasChildren = node.children.length > 0;
  const isOpen = !ctx.collapsed.has(node.id);
  const t = node.total;
  const active = ctx.dragging ?? ctx.moving?.id ?? null;
  const isBlocked = active !== null && ctx.blocked.has(node.id);
  const canDrop = active !== null && !isBlocked;
  const isDropTarget = ctx.dropTarget === node.id;

  return (
    <li>
      <div
        draggable={!ctx.moving}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          ctx.setDragging(node.id);
          ctx.setMenuOpen(null);
        }}
        onDragEnd={() => {
          ctx.setDragging(null);
          ctx.setDropTarget(null);
        }}
        onDragOver={(e) => {
          if (!ctx.dragging || isBlocked) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.setDropTarget(node.id);
        }}
        onDragLeave={() => {
          if (ctx.dropTarget === node.id) ctx.setDropTarget(null);
        }}
        onDrop={(e) => {
          if (!ctx.dragging || isBlocked) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.moveTo(ctx.dragging, node.id);
        }}
        className={`relative flex min-h-12 items-start gap-1 rounded-lg py-1 pr-1 ${
          isDropTarget ? "bg-moss-soft outline-2 outline-moss" : ""
        } ${isBlocked ? "opacity-50" : ""} ${ctx.dragging === node.id ? "opacity-40" : ""}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => ctx.toggle(node.id)}
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

        {node.coverId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/photos/${node.coverId}?v=1`}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            className="mt-1 size-8 shrink-0 rounded-md bg-moss-soft object-cover"
          />
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

        {ctx.moving ? (
          canDrop ? (
            <button
              type="button"
              className="btn btn-primary min-h-9 shrink-0 px-3 text-sm"
              onClick={() => ctx.moveTo(ctx.moving!.id, node.id)}
            >
              Placer ici
            </button>
          ) : null
        ) : (
          <NodeMenu node={node} ctx={ctx} />
        )}
      </div>

      {hasChildren && isOpen && (
        <ul className="grid gap-0.5">
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeMenu({ node, ctx }: { node: TreeViewNode; ctx: Ctx }) {
  const open = ctx.menuOpen === node.id;
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const deletable = node.children.length === 0 && node.todoCount === 0;
  const reason =
    node.children.length > 0 && node.todoCount > 0
      ? "contient des sous-objets et des tâches"
      : node.children.length > 0
        ? "contient des sous-objets"
        : `a ${node.todoCount} tâche${node.todoCount > 1 ? "s" : ""}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ctx.setMenuOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ctx.setMenuOpen(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ctx]);

  const item = "block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-moss-soft";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour ${node.name}`}
        onClick={() => {
          setConfirming(false);
          ctx.setMenuOpen(open ? null : node.id);
        }}
        className="grid size-9 place-items-center rounded-md text-muted hover:bg-moss-soft"
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <circle cx="3" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="13" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions pour ${node.name}`}
          className="reveal absolute right-0 z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-1 shadow-lg"
        >
          {confirming ? (
            <div className="grid gap-2 p-2">
              <p className="text-sm">Supprimer définitivement « {node.name} » ?</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-danger min-h-9 px-3 text-sm" onClick={() => ctx.remove(node)}>
                  Oui, supprimer
                </button>
                <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setConfirming(false)}>
                  Non
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link role="menuitem" href={`/objets/nouveau?parent=${node.id}`} className={item}>
                Ajouter un sous-objet
              </Link>
              <Link
                role="menuitem"
                href={`/taches/nouvelle?objet=${node.id}&retour=${encodeURIComponent(`/objets/${node.id}`)}`}
                className={item}
              >
                Ajouter une tâche
              </Link>
              <Link role="menuitem" href={`/objets/${node.id}/modifier`} className={item}>
                Modifier
              </Link>
              <button type="button" role="menuitem" className={item} onClick={() => ctx.startMove(node)}>
                Déplacer…
              </button>
              {deletable ? (
                <button
                  type="button"
                  role="menuitem"
                  className={`${item} text-brick`}
                  onClick={() => setConfirming(true)}
                >
                  Supprimer…
                </button>
              ) : (
                <p className="px-3 py-2 text-sm text-muted">Suppression impossible : {reason}.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
