"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createObjectsBulkAction, createTodosBulkAction } from "@/app/actions";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "@/lib/format";

export type BulkTarget =
  | { kind: "objets"; parentId: string | null; parentName: string | null }
  | { kind: "taches"; objectId: string; objectName: string };

type Props = {
  target: BulkTarget | null;
  users?: { id: string; name: string }[];
  objectTypes?: { id: string; name: string }[];
  onClose: () => void;
  onDone?: (message: string) => void;
};

const MAX = 50;

/** Boîte de dialogue pour saisir plusieurs noms d'objets ou titres de tâches d'un coup. */
export function BulkAddDialog({ target, users = [], objectTypes = [], onClose, onDone }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [rows, setRows] = useState<string[]>([""]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [type, setType] = useState("");
  const [common, setCommon] = useState({ category: "entretien", priority: "moyenne", assigneeId: "", dueDate: "" });

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (target && !d.open) {
      setRows([""]);
      setError(null);
      setType("");
      setCommon({ category: "entretien", priority: "moyenne", assigneeId: "", dueDate: "" });
      d.showModal();
      setFocusIndex(0);
    }
    if (!target && d.open) d.close();
  }, [target]);

  useEffect(() => {
    if (focusIndex === null) return;
    inputs.current[focusIndex]?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- focus appliqué une seule fois
    setFocusIndex(null);
  }, [focusIndex, rows]);

  const names = rows.map((r) => r.trim()).filter(Boolean);
  const isObjects = target?.kind === "objets";
  const noun = isObjects ? (names.length > 1 ? "objets" : "objet") : names.length > 1 ? "tâches" : "tâche";

  const setRow = (i: number, v: string) => setRows((r) => r.map((x, j) => (j === i ? v : x)));
  const insertAfter = (i: number, values: string[] = [""]) => {
    setRows((r) => [...r.slice(0, i + 1), ...values, ...r.slice(i + 1)].slice(0, MAX));
    setFocusIndex(Math.min(i + values.length, MAX - 1));
  };
  const removeRow = (i: number) => {
    setRows((r) => (r.length === 1 ? [""] : r.filter((_, j) => j !== i)));
    setFocusIndex(Math.max(0, i - 1));
  };

  function submit() {
    if (!target) return;
    if (names.length === 0) {
      setError(isObjects ? "Saisis au moins un nom." : "Saisis au moins un titre.");
      return;
    }
    setError(null);
    start(async () => {
      const r =
        target.kind === "objets"
          ? await createObjectsBulkAction(target.parentId, names, type || null)
          : await createTodosBulkAction(target.objectId, names, {
              category: common.category,
              priority: common.priority,
              assigneeId: common.assigneeId || null,
              dueDate: common.dueDate || null,
            });
      if (r.error) {
        setError(r.error);
        return;
      }
      const n = r.count ?? names.length;
      onDone?.(
        target.kind === "objets"
          ? `${n} objet${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""}${target.parentName ? ` sous « ${target.parentName} »` : ""}.`
          : `${n} tâche${n > 1 ? "s" : ""} créée${n > 1 ? "s" : ""} sur « ${target.objectName} ».`,
      );
      onClose();
    });
  }

  const title = !target
    ? ""
    : target.kind === "objets"
      ? target.parentName
        ? `Ajouter des sous-objets à « ${target.parentName} »`
        : "Ajouter des objets racines"
      : `Ajouter des tâches à « ${target.objectName} »`;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="bulk-title"
      className="m-auto w-[min(96vw,36rem)] rounded-xl bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      {target && (
        <form
          className="grid max-h-[90dvh] grid-rows-[auto_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="border-b border-line p-4">
            <h2 id="bulk-title" className="text-lg font-bold">
              {title}
            </h2>
            <p className="text-sm text-muted">
              Un {isObjects ? "nom" : "titre"} par ligne. Entrée passe à la ligne suivante ; tu peux aussi coller une liste.
            </p>
          </div>

          <div className="grid content-start gap-4 overflow-y-auto p-4">
            <ol className="grid gap-2">
              {rows.map((value, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="num w-6 shrink-0 text-right text-sm text-muted" aria-hidden>
                    {i + 1}
                  </span>
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    className="input"
                    value={value}
                    maxLength={isObjects ? 120 : 200}
                    aria-label={`${isObjects ? "Nom" : "Titre"} ${i + 1}`}
                    onChange={(e) => setRow(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (value.trim() && rows.length < MAX) insertAfter(i);
                        else if (!value.trim() && names.length > 0) submit();
                      } else if (e.key === "Backspace" && value === "" && rows.length > 1) {
                        e.preventDefault();
                        removeRow(i);
                      } else if (e.key === "ArrowDown" && i < rows.length - 1) {
                        e.preventDefault();
                        setFocusIndex(i + 1);
                      } else if (e.key === "ArrowUp" && i > 0) {
                        e.preventDefault();
                        setFocusIndex(i - 1);
                      }
                    }}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      const lines = text
                        .split(/\r?\n/)
                        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
                        .filter(Boolean);
                      if (lines.length <= 1) return;
                      e.preventDefault();
                      const before = value.trim();
                      if (before) {
                        insertAfter(i, lines);
                      } else {
                        setRow(i, lines[0]);
                        if (lines.length > 1) insertAfter(i, lines.slice(1));
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-brick-soft hover:text-brick"
                    aria-label={`Retirer la ligne ${i + 1}`}
                    onClick={() => removeRow(i)}
                  >
                    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ol>
            {rows.length < MAX && (
              <button
                type="button"
                className="w-fit text-sm font-bold text-moss underline-offset-4 hover:underline"
                onClick={() => insertAfter(rows.length - 1)}
              >
                + Ajouter une ligne
              </button>
            )}

            <fieldset className="grid gap-3 border-t border-line pt-4">
              <legend className="pt-1 text-sm text-muted">
                Réglages communs à {isObjects ? "tous ces objets" : "toutes ces tâches"} (modifiables ensuite)
              </legend>
              {isObjects ? (
                <label className="field">
                  <span>Type</span>
                  <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">Sans type</option>
                    {objectTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="field">
                    <span>Catégorie</span>
                    <select
                      className="input"
                      value={common.category}
                      onChange={(e) => setCommon((c) => ({ ...c, category: e.target.value }))}
                    >
                      {Object.entries(CATEGORY_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priorité</span>
                    <select
                      className="input"
                      value={common.priority}
                      onChange={(e) => setCommon((c) => ({ ...c, priority: e.target.value }))}
                    >
                      {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Responsable</span>
                    <select
                      className="input"
                      value={common.assigneeId}
                      onChange={(e) => setCommon((c) => ({ ...c, assigneeId: e.target.value }))}
                    >
                      <option value="">Personne</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Échéance</span>
                    <input
                      className="input"
                      type="date"
                      value={common.dueDate}
                      onChange={(e) => setCommon((c) => ({ ...c, dueDate: e.target.value }))}
                    />
                  </label>
                </div>
              )}
            </fieldset>

            {error && (
              <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
            <button type="submit" className="btn btn-primary" disabled={pending || names.length === 0}>
              {pending ? "Création…" : names.length > 0 ? `Créer ${names.length} ${noun}` : `Créer`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            {rows.length >= MAX && <span className="text-sm text-muted">{MAX} lignes au maximum.</span>}
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Bouton qui ouvre la boîte de dialogue (pour les pages serveur). */
export function BulkAddButton({
  target,
  users,
  objectTypes,
  label,
  className = "btn btn-ghost",
}: {
  target: BulkTarget;
  users?: { id: string; name: string }[];
  objectTypes?: { id: string; name: string }[];
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <BulkAddDialog
        target={open ? target : null}
        users={users}
        objectTypes={objectTypes}
        onClose={() => setOpen(false)} onDone={setMessage} />
      {message && (
        <p role="status" className="basis-full text-sm text-moss">
          {message}
        </p>
      )}
    </>
  );
}
