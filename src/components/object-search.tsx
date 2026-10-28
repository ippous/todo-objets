"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { searchObjectsAction } from "@/app/actions";
import type { ObjectSearchHit } from "@/lib/repo";

/** Champ de recherche d'objets avec suggestions : flèches pour choisir, Entrée pour ouvrir. */
export function ObjectSearch() {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; hits: ObjectSearchHit[]; total: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const query = q.trim();
  useEffect(() => {
    if (!query) return;
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      const r = await searchObjectsAction(query);
      // Ignore les réponses arrivées après une frappe plus récente
      if (n === seq.current) {
        setResult({ q: query, ...r });
        setActive(-1);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Ferme les suggestions quand on clique ailleurs
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const shown = query && result ? result : null;
  const hits = shown?.hits ?? [];
  const expanded = open && !!shown;

  const go = (hit: ObjectSearchHit) => {
    setOpen(false);
    router.push(`/objets/${hit.id}`);
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="field">
        <span className="sr-only">Rechercher un objet</span>
        <input
          className="input"
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Rechercher un objet (nom, type, lieu, tag, description)"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (!hits.length) return;
              e.preventDefault();
              setOpen(true);
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => (a + step + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = hits[active >= 0 ? active : 0];
              if (hit) go(hit);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </label>
      {expanded && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {hits.length === 0 ? (
            <p className="p-3 text-muted">Aucun objet ne correspond à « {shown.q} ».</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Objets trouvés" className="max-h-96 overflow-y-auto py-1">
              {hits.map((h, i) => (
                <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={`/objets/${h.id}`}
                    tabIndex={-1}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(i)}
                    className={`block px-3 py-2 ${i === active ? "bg-moss-soft" : ""}`}
                  >
                    <span className="font-bold">{h.name}</span>
                    {h.type && <span className="text-sm text-muted"> · {h.type}</span>}
                    {h.path && <span className="block text-sm text-muted">{h.path}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shown.total > hits.length && (
            <p className="border-t border-line px-3 py-2 text-sm text-muted">
              {shown.total} objets trouvés : affine la recherche pour voir les autres.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
