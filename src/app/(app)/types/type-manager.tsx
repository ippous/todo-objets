"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createTypeAction, deleteTypeAction, renameTypeAction } from "@/app/actions";
import { FormError, Submit } from "@/components/submit";
import type { TypeKind, TypeWithUsage } from "@/lib/repo";

export function TypeManager({
  kind,
  title,
  types,
  unit,
}: {
  kind: TypeKind;
  title: string;
  types: TypeWithUsage[];
  unit: [string, string];
}) {
  const [state, action] = useActionState(createTypeAction.bind(null, kind), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  const headingId = `types-${kind}`;

  return (
    <section aria-labelledby={headingId} className="grid content-start gap-3">
      <h2 id={headingId} className="text-lg font-bold">
        {title} <span className="font-normal text-muted">({types.length})</span>
      </h2>
      <ul className="rounded-xl bg-surface px-4">
        {types.map((t) => (
          <TypeRow key={t.id} kind={kind} type={t} unit={unit} />
        ))}
        {types.length === 0 && <li className="py-3 text-muted">Aucun type pour l&apos;instant.</li>}
      </ul>
      <form ref={form} action={action} className="flex flex-wrap items-end gap-2">
        <label className="field flex-1">
          <span>Nouveau type</span>
          <input className="input" name="name" required maxLength={60} />
        </label>
        <Submit className="btn btn-ghost" pendingLabel="Ajout…">
          Ajouter
        </Submit>
      </form>
      <FormError error={state.error} />
    </section>
  );
}

function TypeRow({ kind, type, unit }: { kind: TypeKind; type: TypeWithUsage; unit: [string, string] }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [state, action] = useActionState(renameTypeAction.bind(null, kind, type.id), {});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fermeture de l'édition après succès
    if (state.ok) setEditing(false);
  }, [state]);
  const used = type.usage > 0;

  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0">
      {editing ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`rename-${type.id}`}>
            Nouveau nom pour {type.name}
          </label>
          <input
            id={`rename-${type.id}`}
            className="input min-h-9 flex-1 py-1"
            name="name"
            defaultValue={type.name}
            required
            maxLength={60}
            autoFocus
          />
          <Submit className="btn btn-primary min-h-9 px-3 text-sm" pendingLabel="…">
            Enregistrer
          </Submit>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setEditing(false)}>
            Annuler
          </button>
        </form>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1">Supprimer le type « {type.name} » ?</span>
          <button
            type="button"
            className="btn btn-danger min-h-9 px-3 text-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteTypeAction(kind, type.id);
                if (r.error) setError(r.error);
                setConfirming(false);
              })
            }
          >
            Oui, supprimer
          </button>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setConfirming(false)}>
            Non
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 font-bold">{type.name}</span>
          <span className="num text-sm text-muted">
            {used ? `${type.usage} ${type.usage > 1 ? unit[1] : unit[0]}` : "inutilisé"}
          </span>
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-sm"
            aria-label={`Renommer ${type.name}`}
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
          >
            Renommer
          </button>
          <button
            type="button"
            className="btn btn-ghost min-h-9 px-3 text-sm disabled:cursor-not-allowed"
            aria-label={`Supprimer ${type.name}`}
            disabled={used}
            title={used ? `Utilisé par ${type.usage} ${type.usage > 1 ? unit[1] : unit[0]}` : undefined}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Supprimer
          </button>
        </div>
      )}
      <FormError error={state.error ?? error ?? undefined} />
    </li>
  );
}
