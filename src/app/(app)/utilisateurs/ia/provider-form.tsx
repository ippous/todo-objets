"use client";

import { useActionState, useEffect, useRef, useTransition, useState } from "react";
import { saveAiProviderAction, setDefaultAiProviderAction } from "@/app/ai-actions";
import { FormError, Submit } from "@/components/submit";
import type { AiProvider } from "@/lib/ai";

export function ProviderForm({
  provider,
  label,
  model,
  defaultModel,
  suggestions,
  configured,
  keyHint,
  isDefault,
  consoleUrl,
}: {
  provider: AiProvider;
  label: string;
  model: string;
  defaultModel: string;
  suggestions: string[];
  configured: boolean;
  keyHint: string | null;
  isDefault: boolean;
  consoleUrl: string;
}) {
  const [state, action] = useActionState(saveAiProviderAction.bind(null, provider), {});
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.ok && keyInput.current) keyInput.current.value = "";
  }, [state]);
  const id = `ia-${provider}`;

  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={id} className="flex-1 text-lg font-bold">
          {label}
        </h2>
        {configured ? (
          <span className="rounded bg-moss-soft px-2 py-0.5 text-sm font-bold text-moss">
            Clé enregistrée {keyHint}
          </span>
        ) : (
          <span className="rounded bg-paper px-2 py-0.5 text-sm text-muted">Pas de clé</span>
        )}
        {isDefault && <span className="rounded bg-ochre-soft px-2 py-0.5 text-sm font-bold text-ochre">Par défaut</span>}
      </div>
      <form ref={form} action={action} className="grid gap-3">
        <label className="field">
          <span>
            Clé d&apos;API{" "}
            <a href={consoleUrl} target="_blank" rel="noopener noreferrer" className="text-moss underline-offset-4 hover:underline">
              (en créer une)
            </a>
          </span>
          <input
            ref={keyInput}
            className="input"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={configured ? "Laisser vide pour garder la clé actuelle" : "Coller la clé ici"}
          />
        </label>
        <label className="field">
          <span>Modèle</span>
          <input className="input" name="model" defaultValue={model} placeholder={defaultModel} list={`${id}-modeles`} spellCheck={false} />
          <datalist id={`${id}-modeles`}>
            {suggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        {!isDefault && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="makeDefault" className="size-5 accent-moss" />
            Utiliser par défaut
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Submit>Enregistrer</Submit>
          {configured && !isDefault && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setDefaultAiProviderAction(provider);
                  setError(r.error ?? null);
                })
              }
            >
              Mettre par défaut
            </button>
          )}
          {configured && (
            <Submit className="btn btn-ghost text-brick" name="removeKey" value="1" pendingLabel="…">
              Retirer la clé
            </Submit>
          )}
        </div>
        {state.ok && <p role="status" className="text-sm text-moss">Enregistré.</p>}
        <FormError error={state.error ?? error ?? undefined} />
      </form>
    </section>
  );
}
