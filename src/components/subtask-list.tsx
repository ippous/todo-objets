"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { addSubtaskAction, deleteSubtaskAction, reorderSubtasksAction, updateSubtaskAction } from "@/app/actions";
import { fmtHours, fmtNum } from "@/lib/format";
import { FormError } from "./submit";

export type SubtaskItem = { id: string; title: string; done: boolean; estHours: number | null; actualHours: number | null };

type Hours = { estHours?: number | null; actualHours?: number | null };

type Change =
  | { kind: "done"; id: string; done: boolean }
  | { kind: "title"; id: string; title: string }
  | { kind: "hours"; id: string; hours: Hours }
  | { kind: "delete"; id: string }
  | { kind: "order"; ids: string[] };

function apply(list: SubtaskItem[], c: Change): SubtaskItem[] {
  switch (c.kind) {
    case "done":
      return list.map((s) => (s.id === c.id ? { ...s, done: c.done } : s));
    case "title":
      return list.map((s) => (s.id === c.id ? { ...s, title: c.title } : s));
    case "hours":
      return list.map((s) => (s.id === c.id ? { ...s, ...c.hours } : s));
    case "delete":
      return list.filter((s) => s.id !== c.id);
    case "order": {
      const byId = new Map(list.map((s) => [s.id, s]));
      return c.ids.flatMap((id) => byId.get(id) ?? []);
    }
  }
}

/** Déplace `id` juste avant (ou après) `targetId` ; retourne le nouvel ordre. */
function moved(ids: string[], id: string, targetId: string, after: boolean): string[] {
  const rest = ids.filter((i) => i !== id);
  const at = rest.indexOf(targetId);
  if (at < 0) return ids;
  rest.splice(after ? at + 1 : at, 0, id);
  return rest;
}

/** « 1,5 » → 1.5 ; vide → null ; illisible → NaN. */
function parseHours(raw: string): number | null {
  const v = raw.replace(/\s/g, "").replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function sum(list: SubtaskItem[], k: "estHours" | "actualHours") {
  const v = list.map((s) => s[k]).filter((x): x is number => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

const iconBtn = "min-h-9 min-w-8 shrink-0 rounded-md px-1.5 py-1 hover:bg-moss-soft disabled:opacity-30";
// Pas la classe .input (largeur 100 %) : un petit champ compact pour tenir sur la ligne
const hoursInput =
  "num h-9 w-14 shrink-0 rounded-md border border-line bg-paper px-1.5 text-right text-sm text-ink focus:border-transparent focus:outline-2 focus:outline-moss sm:w-16";

/**
 * Sous-tâches d'une tâche : une case à cocher, un texte et deux durées (prévue, réalisée), sur une ligne.
 * On réordonne en glissant une ligne (souris) ou avec les flèches de la ligne (tactile, clavier).
 * Ce composant vit dans le formulaire de la tâche : aucun <form> imbriqué, aucun champ nommé,
 * et la touche Entrée est interceptée pour ne pas enregistrer la tâche.
 */
export function SubtaskList({ todoId, items }: { todoId: string; items: SubtaskItem[] }) {
  const [list, change] = useOptimistic(items, apply);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const [, start] = useTransition();

  const run = (c: Change, call: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      change(c);
      const r = await call();
      if (r.error) setError(r.error);
    });

  const reorder = (ids: string[]) => {
    if (ids.join() === list.map((s) => s.id).join()) return;
    run({ kind: "order", ids }, () => reorderSubtasksAction(todoId, ids));
  };

  const saveHours = (s: SubtaskItem, k: "estHours" | "actualHours", raw: string) => {
    const v = parseHours(raw);
    if (Number.isNaN(v)) {
      setError("Durée invalide : un nombre d'heures, par exemple 1,5");
      return false;
    }
    if (v === s[k]) return true;
    run({ kind: "hours", id: s.id, hours: { [k]: v } }, () => updateSubtaskAction(s.id, { [k]: v }));
    return true;
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const done = list.filter((s) => s.done).length;
  const totalEst = sum(list, "estHours");
  const totalActual = sum(list, "actualHours");

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      {list.length > 0 && (
        <div className="rounded-xl bg-surface px-2">
          <div className="flex items-center gap-1.5 border-b border-line py-1.5 text-xs text-muted" aria-hidden>
            <span className="flex-1 pl-1" data-testid="sous-taches-compte">
              {done} sur {list.length} faite{done > 1 ? "s" : ""}
            </span>
            <span className="w-14 text-right sm:w-16">Prévu (h)</span>
            <span className="w-14 text-right sm:w-16">Réalisé (h)</span>
            <span className="w-32" />
          </div>
          <ul aria-label="Sous-tâches">
            {list.map((s, i) => (
              <li
                key={s.id}
                data-testid="sous-tache"
                draggable={editing !== s.id}
                onDragStart={(e) => {
                  if ((e.target as HTMLElement).closest("input")) return e.preventDefault();
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", s.id);
                  setDragging(s.id);
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt({ id: s.id, after: e.clientY > r.top + r.height / 2 });
                }}
                onDrop={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  const after = e.clientY > e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2;
                  if (dragging !== s.id)
                    reorder(
                      moved(
                        list.map((x) => x.id),
                        dragging,
                        s.id,
                        after,
                      ),
                    );
                  endDrag();
                }}
                className={`flex flex-nowrap items-center gap-1.5 border-b border-line py-1 last:border-b-0 ${
                  dragging === s.id ? "opacity-40" : ""
                } ${
                  dropAt?.id === s.id && dragging !== s.id
                    ? dropAt.after
                      ? "shadow-[inset_0_-3px_0_var(--moss)]"
                      : "shadow-[inset_0_3px_0_var(--moss)]"
                    : ""
                }`}
              >
                <span aria-hidden className="hidden cursor-grab text-muted select-none active:cursor-grabbing sm:inline" title="Glisser pour déplacer">
                  ⠿
                </span>
                {editing === s.id ? (
                  <EditTitle
                    initial={s.title}
                    onCancel={() => setEditing(null)}
                    onSave={(title) => {
                      setEditing(null);
                      if (title.trim() && title.trim() !== s.title)
                        run({ kind: "title", id: s.id, title: title.trim() }, () => updateSubtaskAction(s.id, { title }));
                    }}
                  />
                ) : (
                  <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-moss"
                      checked={s.done}
                      onChange={(e) => {
                        const v = e.target.checked;
                        run({ kind: "done", id: s.id, done: v }, () => updateSubtaskAction(s.id, { done: v }));
                      }}
                    />
                    <span className={`truncate ${s.done ? "text-muted line-through" : ""}`} title={s.title}>
                      {s.title}
                    </span>
                  </label>
                )}
                <HoursInput
                  key={`e${s.estHours}`}
                  value={s.estHours}
                  label={`Durée prévue de « ${s.title} », en heures`}
                  onSave={(raw) => saveHours(s, "estHours", raw)}
                />
                <HoursInput
                  key={`a${s.actualHours}`}
                  value={s.actualHours}
                  label={`Durée réalisée de « ${s.title} », en heures`}
                  onSave={(raw) => saveHours(s, "actualHours", raw)}
                />
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={`${iconBtn} font-bold text-moss`}
                    disabled={i === 0}
                    aria-label={`Monter « ${s.title} »`}
                    title="Monter"
                    onClick={() => reorder(moved(list.map((x) => x.id), s.id, list[i - 1].id, false))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} font-bold text-moss`}
                    disabled={i === list.length - 1}
                    aria-label={`Descendre « ${s.title} »`}
                    title="Descendre"
                    onClick={() => reorder(moved(list.map((x) => x.id), s.id, list[i + 1].id, true))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} text-moss`}
                    aria-label={`Modifier « ${s.title} »`}
                    title="Modifier le texte"
                    onClick={() => setEditing(s.id)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={`${iconBtn} text-brick hover:bg-brick-soft`}
                    aria-label={`Supprimer « ${s.title} »`}
                    title="Supprimer"
                    onClick={() => run({ kind: "delete", id: s.id }, () => deleteSubtaskAction(s.id))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {(totalEst != null || totalActual != null) && (
            <div className="flex items-center gap-1.5 border-t border-line py-1.5 text-sm font-bold" data-testid="sous-taches-total">
              <span className="flex-1 pl-1">Total</span>
              <span className="num w-14 text-right sm:w-16">{fmtHours(totalEst)}</span>
              <span className="num w-14 text-right sm:w-16">{fmtHours(totalActual)}</span>
              <span className="w-32" />
            </div>
          )}
        </div>
      )}
      <AddSubtask todoId={todoId} onError={setError} />
      <FormError error={error ?? undefined} />
    </div>
  );
}

/** Champ de durée : enregistre en quittant le champ ou sur Entrée. */
function HoursInput({ value, label, onSave }: { value: number | null; label: string; onSave: (raw: string) => boolean }) {
  const [raw, setRaw] = useState(fmtNum(value));
  const commit = () => {
    if (raw.trim() === fmtNum(value)) return;
    if (!onSave(raw)) setRaw(fmtNum(value));
  };
  return (
    <input
      className={hoursInput}
      inputMode="decimal"
      aria-label={label}
      placeholder="—"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") setRaw(fmtNum(value));
      }}
    />
  );
}

function AddSubtask({ todoId, onError }: { todoId: string; onError: (e: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [est, setEst] = useState("");
  const [actual, setActual] = useState("");
  const [pending, start] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  const add = () => {
    if (!title.trim()) {
      onError("Saisis le texte de la sous-tâche");
      titleRef.current?.focus();
      return;
    }
    const estHours = parseHours(est);
    const actualHours = parseHours(actual);
    if (Number.isNaN(estHours) || Number.isNaN(actualHours)) {
      onError("Durée invalide : un nombre d'heures, par exemple 1,5");
      return;
    }
    start(async () => {
      onError(null);
      const r = await addSubtaskAction(todoId, { title, estHours, actualHours });
      if (r.error) return onError(r.error);
      setTitle("");
      setEst("");
      setActual("");
      titleRef.current?.focus();
    });
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Ajout d’une sous-tâche">
      <input
        ref={titleRef}
        className="input min-w-0 flex-1"
        aria-label="Nouvelle sous-tâche"
        maxLength={300}
        placeholder="Ajouter une sous-tâche…"
        autoComplete="off"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onEnter}
      />
      <input
        className={hoursInput}
        inputMode="decimal"
        aria-label="Durée prévue, en heures"
        placeholder="Prévu"
        value={est}
        onChange={(e) => setEst(e.target.value)}
        onKeyDown={onEnter}
      />
      <input
        className={hoursInput}
        inputMode="decimal"
        aria-label="Durée réalisée, en heures"
        placeholder="Réal."
        value={actual}
        onChange={(e) => setActual(e.target.value)}
        onKeyDown={onEnter}
      />
      <button type="button" className="btn btn-ghost shrink-0" disabled={pending} onClick={add}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
    </div>
  );
}

function EditTitle({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 py-1">
      <input
        className="input min-w-0 flex-1 py-1"
        aria-label="Texte de la sous-tâche"
        value={value}
        maxLength={300}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(value);
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className={`${iconBtn} font-bold text-moss`} aria-label="Enregistrer le texte" onClick={() => onSave(value)}>
        ✓
      </button>
      <button type="button" className={`${iconBtn} text-muted`} aria-label="Annuler" onClick={onCancel}>
        ↺
      </button>
    </span>
  );
}
