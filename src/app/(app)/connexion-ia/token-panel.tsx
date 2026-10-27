"use client";

import { useActionState, useState, useTransition } from "react";
import { Submit } from "@/components/submit";
import { createTokenAction, revokeAccessAction, type CreateTokenState } from "./actions";

export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost min-h-9 px-3 text-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* copie manuelle */
        }
      }}
    >
      {done ? "Copié ✓" : label}
    </button>
  );
}

export function CreateToken() {
  const [state, action] = useActionState<CreateTokenState, FormData>(createTokenAction, {});
  return (
    <div className="grid gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="field flex-1">
          <span>Nom du jeton</span>
          <input className="input" name="name" maxLength={80} placeholder="Claude Desktop sur le PC" required />
        </label>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Droits du jeton</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="droits" value="lecture" defaultChecked /> Lecture seule
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="droits" value="ecriture" /> Lecture et écriture
          </label>
        </fieldset>
        <Submit className="btn btn-primary" pendingLabel="Création…">
          Créer un jeton
        </Submit>
      </form>
      {state.error && (
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
          {state.error}
        </p>
      )}
      {state.token && (
        <div role="status" className="grid gap-2 rounded-xl border-2 border-moss bg-moss-soft p-4">
          <p className="font-bold">
            Jeton « {state.name} » ({state.write ? "lecture et écriture" : "lecture seule"}) créé. Copie-le maintenant : il ne
            sera plus jamais affiché.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code data-testid="nouveau-jeton" className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 text-sm">
              {state.token}
            </code>
            <CopyButton text={state.token} />
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeButton({ id, label }: { id: string; label: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirm) {
    return (
      <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" aria-label={`Retirer l'accès ${label}`} onClick={() => setConfirm(true)}>
        Retirer l&apos;accès
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm">Retirer l&apos;accès ?</span>
      <button
        type="button"
        className="btn btn-danger min-h-9 px-3 text-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revokeAccessAction(id);
            if (r.error) setError(r.error);
            setConfirm(false);
          })
        }
      >
        Oui, retirer
      </button>
      <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setConfirm(false)}>
        Non
      </button>
      {error && <span className="text-sm text-brick">{error}</span>}
    </span>
  );
}

export function RightsBadge({ write }: { write: boolean }) {
  return write ? (
    <span className="rounded-full bg-ochre-soft px-2 py-0.5 text-xs font-bold text-ochre">lecture et écriture</span>
  ) : (
    <span className="rounded-full bg-moss-soft px-2 py-0.5 text-xs font-bold text-moss">lecture seule</span>
  );
}
