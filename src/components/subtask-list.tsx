"use client";

import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { addSubtaskAction, deleteSubtaskAction, reorderSubtasksAction, updateSubtaskAction } from "@/app/actions";
import { FormError, Submit } from "./submit";

export type SubtaskItem = { id: string; title: string; done: boolean };

type Change =
  | { kind: "done"; id: string; done: boolean }
  | { kind: "title"; id: string; title: string }
  | { kind: "delete"; id: string }
  | { kind: "order"; ids: string[] };

function apply(list: SubtaskItem[], c: Change): SubtaskItem[] {
  switch (c.kind) {
    case "done":
      return list.map((s) => (s.id === c.id ? { ...s, done: c.done } : s));
    case "title":
      return list.map((s) => (s.id === c.id ? { ...s, title: c.title } : s));
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

/**
 * Sous-tâches d'une tâche : du texte et une case à cocher, dans un ordre choisi.
 * On réordonne en glissant une ligne (souris) ou avec les flèches de la ligne (tactile, clavier).
 */
export function SubtaskList({ todoId, items }: { todoId: string; items: SubtaskItem[] }) {
  const [list, change] = useOptimistic(items, apply);
  const [state, addAction] = useActionState(addSubtaskAction.bind(null, todoId), {});
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (state.ok) {
      form.current?.reset();
      form.current?.querySelector("input")?.focus();
    }
  }, [state]);

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

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const done = list.filter((s) => s.done).length;

  return (
    <div className="grid gap-3">
      {list.length > 0 && (
        <>
          <p className="text-sm text-muted" data-testid="sous-taches-compte">
            {done} sur {list.length} faite{done > 1 ? "s" : ""}
          </p>
          <ul className="rounded-xl bg-surface px-2" aria-label="Sous-tâches">
            {list.map((s, i) => (
              <li
                key={s.id}
                data-testid="sous-tache"
                draggable={editing !== s.id}
                onDragStart={(e) => {
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
                className={`flex flex-wrap items-center gap-x-2 border-b border-line py-1.5 last:border-b-0 ${
                  dragging === s.id ? "opacity-40" : ""
                } ${
                  dropAt?.id === s.id && dragging !== s.id
                    ? dropAt.after
                      ? "shadow-[inset_0_-3px_0_var(--moss)]"
                      : "shadow-[inset_0_3px_0_var(--moss)]"
                    : ""
                }`}
              >
                <span aria-hidden className="cursor-grab px-1 text-muted select-none active:cursor-grabbing" title="Glisser pour déplacer">
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
                  <>
                    <label className="flex min-h-10 min-w-48 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-moss"
                        checked={s.done}
                        onChange={(e) => {
                          const v = e.target.checked;
                          run({ kind: "done", id: s.id, done: v }, () => updateSubtaskAction(s.id, { done: v }));
                        }}
                      />
                      <span className={`break-words ${s.done ? "text-muted line-through" : ""}`}>{s.title}</span>
                    </label>
                    <span className="ml-auto flex shrink-0 items-center">
                      <button
                        type="button"
                        className="min-h-9 min-w-9 rounded-md px-2 py-1 font-bold text-moss hover:bg-moss-soft disabled:opacity-30"
                        disabled={i === 0}
                        aria-label={`Monter « ${s.title} »`}
                        onClick={() => reorder(moved(list.map((x) => x.id), s.id, list[i - 1].id, false))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="min-h-9 min-w-9 rounded-md px-2 py-1 font-bold text-moss hover:bg-moss-soft disabled:opacity-30"
                        disabled={i === list.length - 1}
                        aria-label={`Descendre « ${s.title} »`}
                        onClick={() => reorder(moved(list.map((x) => x.id), s.id, list[i + 1].id, true))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="min-h-9 rounded-md px-2 py-1 text-sm text-moss hover:bg-moss-soft"
                        aria-label={`Modifier « ${s.title} »`}
                        onClick={() => setEditing(s.id)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="min-h-9 rounded-md px-2 py-1 text-sm text-brick hover:bg-brick-soft"
                        aria-label={`Supprimer « ${s.title} »`}
                        onClick={() => run({ kind: "delete", id: s.id }, () => deleteSubtaskAction(s.id))}
                      >
                        Supprimer
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <form ref={form} action={addAction} className="flex gap-2">
        <label className="sr-only" htmlFor="nouvelle-sous-tache">
          Nouvelle sous-tâche
        </label>
        <input
          id="nouvelle-sous-tache"
          className="input min-w-0 flex-1"
          name="title"
          required
          maxLength={300}
          placeholder="Ajouter une sous-tâche…"
          autoComplete="off"
        />
        <Submit className="btn btn-ghost" pendingLabel="Ajout…">
          Ajouter
        </Submit>
      </form>
      <FormError error={state.error ?? error ?? undefined} />
    </div>
  );
}

function EditTitle({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex min-w-0 flex-1 gap-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <input
        className="input min-w-0 flex-1"
        aria-label="Texte de la sous-tâche"
        value={value}
        maxLength={300}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className="btn btn-primary min-h-9 px-3 text-sm">
        Enregistrer
      </button>
      <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={onCancel}>
        Annuler
      </button>
    </form>
  );
}
