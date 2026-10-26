"use client";

import { useActionState } from "react";
import { signInWithDevLogin } from "@/app/actions";
import { FormError, Submit } from "@/components/submit";

export function DevLoginForm() {
  const [state, action] = useActionState(signInWithDevLogin, {});
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-dashed border-line p-4">
      <p className="text-sm text-muted">Connexion de test (environnement de dev uniquement)</p>
      <label className="field">
        <span>Adresse e-mail autorisée</span>
        <input className="input" type="email" name="email" required autoComplete="email" />
      </label>
      <label className="field">
        <span>Code de test</span>
        <input className="input" type="password" name="secret" required autoComplete="off" />
      </label>
      <FormError error={state.error} />
      <Submit className="btn btn-ghost" pendingLabel="Connexion…">
        Se connecter
      </Submit>
    </form>
  );
}
