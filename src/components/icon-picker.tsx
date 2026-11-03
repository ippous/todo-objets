"use client";

import { useRef } from "react";
import { TASK_ICON_GROUPS, TaskIcon, taskIconLabel } from "@/lib/task-icons";

/**
 * Bouton qui montre l'icône choisie et ouvre une grille d'icônes à sélectionner.
 * `name` ajoute un champ caché pour les formulaires ; sinon on réagit avec `onChange`.
 */
export function IconPicker({
  value,
  onChange,
  name,
  label,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  name?: string;
  /** Pour l'accessibilité : « Icône du type Entretien »… */
  label: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pick = (icon: string | null) => {
    onChange(icon);
    dialog.current?.close();
  };
  const current = taskIconLabel(value);

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <button
        type="button"
        className="grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-surface text-moss hover:bg-moss-soft"
        aria-label={`${label} : ${current ?? "aucune"}. Changer l'icône`}
        title={current ? `Icône : ${current}` : "Choisir une icône"}
        onClick={() => dialog.current?.showModal()}
      >
        {value ? <TaskIcon icon={value} size={22} /> : <span className="text-xl leading-none text-muted">+</span>}
      </button>
      <dialog
        ref={dialog}
        aria-label={label}
        className="m-auto max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] rounded-xl bg-paper p-0 text-ink shadow-xl backdrop:bg-black/40"
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="grid gap-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{label}</h2>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => dialog.current?.close()}>
              Fermer
            </button>
          </div>
          <button
            type="button"
            className={`btn min-h-9 w-fit px-3 text-sm ${value ? "btn-ghost" : "btn-primary"}`}
            aria-pressed={!value}
            onClick={() => pick(null)}
          >
            Aucune icône
          </button>
          {TASK_ICON_GROUPS.map((g) => (
            <section key={g.title} className="grid gap-2">
              <h3 className="text-sm font-bold text-muted">{g.title}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
                {g.icons.map((i) => (
                  <button
                    key={i.key}
                    type="button"
                    aria-label={i.label}
                    aria-pressed={value === i.key}
                    title={i.label}
                    onClick={() => pick(i.key)}
                    className={`grid aspect-square place-items-center rounded-lg border ${
                      value === i.key ? "border-moss bg-moss-soft text-moss" : "border-line bg-surface text-ink hover:bg-moss-soft"
                    }`}
                  >
                    <i.Icon size={22} strokeWidth={1.75} aria-hidden />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
