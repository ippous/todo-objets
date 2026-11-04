"use client";

import { useId, useMemo, useRef, useState } from "react";
import { fmtDate, STATUS_LABEL } from "@/lib/format";

export type DependencyCandidate = {
  id: string;
  title: string;
  objectName: string;
  status: keyof typeof STATUS_LABEL;
  dueDate: string | null;
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Tâches attendues (fin → début) : recherche par titre ou objet, puis puces retirables.
 * Envoie des champs cachés « dependsOn » (un par tâche) et « dependsOnPresent ».
 */
export function DependencyPicker({ candidates, value }: { candidates: DependencyCandidate[]; value: string[] }) {
  const [selected, setSelected] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const matches = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return candidates
      .filter((c) => !selected.includes(c.id))
      .filter((c) => words.every((w) => fold(`${c.title} ${c.objectName}`).includes(w)))
      .slice(0, 8);
  }, [candidates, selected, q]);

  const add = (id: string) => {
    setSelected((s) => [...s, id]);
    setQ("");
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="field">
      <span>Attend (tâches à terminer avant)</span>
      <input type="hidden" name="dependsOnPresent" value="1" />
      {selected.map((id) => (
        <input key={id} type="hidden" name="dependsOn" value={id} />
      ))}
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Tâches attendues">
          {selected.map((id) => {
            const c = byId.get(id);
            const done = c?.status === "fait";
            return (
              <li
                key={id}
                className={`flex max-w-full items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm ${done ? "bg-moss-soft text-moss" : "bg-ochre-soft text-ink"}`}
              >
                <span className="truncate">
                  {done ? "✓ " : ""}
                  {c?.title ?? "Tâche"}
                  {c && <span className="text-muted"> · {c.objectName}</span>}
                </span>
                <button
                  type="button"
                  className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-surface"
                  aria-label={`Ne plus attendre « ${c?.title ?? "cette tâche"} »`}
                  onClick={() => setSelected((s) => s.filter((x) => x !== id))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          className="input w-full"
          type="search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-label="Ajouter une tâche attendue"
          placeholder="Chercher une tâche à attendre…"
          value={q}
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!matches.length) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              add(matches[Math.min(active, matches.length - 1)].id);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && q.trim() !== "" && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 grid max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg"
          >
            {matches.length === 0 && <li className="px-3 py-1.5 text-muted">Aucune tâche ne correspond.</li>}
            {matches.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={`grid w-full px-3 py-1.5 text-left ${i === active ? "bg-moss-soft" : "hover:bg-paper"}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(c.id)}
                >
                  <span className="font-bold">{c.title}</span>
                  <span className="text-muted">
                    {c.objectName} · {STATUS_LABEL[c.status]}
                    {c.dueDate ? ` · ${fmtDate(c.dueDate)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm text-muted">Tant qu&apos;une de ces tâches n&apos;est pas faite, celle-ci est « bloquée ».</p>
    </div>
  );
}
