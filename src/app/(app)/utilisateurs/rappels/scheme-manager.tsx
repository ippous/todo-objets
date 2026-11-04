"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createSchemeAction, deleteSchemeAction, setDefaultSchemeAction, updateSchemeAction } from "@/app/reminder-actions";
import { FormError, Submit } from "@/components/submit";

type Scheme = { id: string; name: string; offsets: string; isDefault: boolean; usage: number };

const HINT = "Ex. J-10 / J-5 / J-2 / J-1 ou J-10 / J-1 / H-3 / M-10";

export function SchemeManager({ schemes }: { schemes: Scheme[] }) {
  const [state, action] = useActionState(createSchemeAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <div className="grid gap-6">
      <ul className="rounded-xl bg-surface px-4">
        {schemes.map((s) => (
          <SchemeRow key={s.id} scheme={s} />
        ))}
        {schemes.length === 0 && <li className="py-3 text-muted">Aucun schéma pour l&apos;instant.</li>}
      </ul>
      <section aria-labelledby="nouveau-schema" className="grid gap-3">
        <h2 id="nouveau-schema" className="text-lg font-bold">
          Nouveau schéma
        </h2>
        <form ref={form} action={action} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <label className="field">
              <span>Nom</span>
              <input className="input" name="name" required maxLength={60} placeholder="Rendez-vous" />
            </label>
            <label className="field">
              <span>Rappels</span>
              <input className="input" name="offsets" required placeholder={HINT} spellCheck={false} />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isDefault" className="size-5 accent-moss" />
            Proposé par défaut pour les nouvelles tâches
          </label>
          <Submit className="btn btn-primary w-fit" pendingLabel="Ajout…">
            Ajouter le schéma
          </Submit>
        </form>
        <FormError error={state.error} />
      </section>
    </div>
  );
}

function SchemeRow({ scheme }: { scheme: Scheme }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [state, action] = useActionState(updateSchemeAction.bind(null, scheme.id), {});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fermeture de l'édition après succès
    if (state.ok) setEditing(false);
  }, [state]);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      setConfirming(false);
    });

  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0">
      {editing ? (
        <form action={action} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-center">
          <input className="input min-h-9 py-1" name="name" defaultValue={scheme.name} required maxLength={60} aria-label="Nom du schéma" autoFocus />
          <input className="input min-h-9 py-1" name="offsets" defaultValue={scheme.offsets} required aria-label="Rappels" placeholder={HINT} spellCheck={false} />
          <Submit className="btn btn-primary min-h-9 px-3 text-sm" pendingLabel="…">
            Enregistrer
          </Submit>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setEditing(false)}>
            Annuler
          </button>
          <div className="sm:col-span-4">
            <FormError error={state.error} />
          </div>
        </form>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1">
            Supprimer « {scheme.name} » ?
            {scheme.usage > 0 && ` ${scheme.usage} tâche${scheme.usage > 1 ? "s" : ""} ouverte${scheme.usage > 1 ? "s" : ""} n'aur${scheme.usage > 1 ? "ont" : "a"} plus de rappel.`}
          </span>
          <button type="button" className="btn btn-danger min-h-9 px-3 text-sm" disabled={pending} onClick={() => run(() => deleteSchemeAction(scheme.id))}>
            Oui, supprimer
          </button>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setConfirming(false)}>
            Non
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold">{scheme.name}</span>
          {scheme.isDefault && <span className="rounded bg-ochre-soft px-2 py-0.5 text-sm font-bold text-ochre">Par défaut</span>}
          <span className="num flex-1 text-muted">{scheme.offsets}</span>
          <span className="num text-sm text-muted">
            {scheme.usage > 0 ? `${scheme.usage} tâche${scheme.usage > 1 ? "s" : ""}` : "inutilisé"}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              className="btn btn-ghost min-h-9 px-3 text-sm"
              disabled={pending}
              onClick={() => run(() => setDefaultSchemeAction(scheme.isDefault ? null : scheme.id))}
            >
              {scheme.isDefault ? "Retirer le défaut" : "Par défaut"}
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setEditing(true)}>
              Modifier
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm text-brick" onClick={() => setConfirming(true)}>
              Supprimer
            </button>
          </div>
        </div>
      )}
      {error && <FormError error={error} />}
    </li>
  );
}
