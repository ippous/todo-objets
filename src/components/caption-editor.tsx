"use client";

import { useId, useState, useTransition } from "react";

/** Description en texte simple d'une photo ou d'un document : affichée, et modifiable sur place. */
export function CaptionEditor({
  value,
  label,
  onSave,
}: {
  value: string | null;
  /** Ce qui est décrit, pour les libellés accessibles (ex. « la photo », « facture.pdf »). */
  label: string;
  onSave: (description: string) => Promise<{ error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fieldId = useId();

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-wrap items-start gap-x-2">
        {value && <p className="min-w-0 flex-1 whitespace-pre-line text-sm">{value}</p>}
        <button
          type="button"
          className="text-sm text-muted underline underline-offset-4 hover:text-ink"
          aria-label={value ? `Modifier la description de ${label}` : `Ajouter une description à ${label}`}
          onClick={() => {
            setDraft(value ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          {value ? "Modifier la description" : "Ajouter une description"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await onSave(draft);
          if (r.error) setError(r.error);
          else setEditing(false);
        });
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        Description de {label}
      </label>
      <textarea
        id={fieldId}
        className="input min-h-20 text-sm"
        maxLength={2000}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
      />
      {error && (
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary min-h-9 px-3 text-sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" disabled={pending} onClick={() => setEditing(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}
