"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUserAction, updateUserAction } from "@/app/actions";
import { FormError, Submit } from "@/components/submit";
import { fmtNum } from "@/lib/format";

type U = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "membre";
  weeklyHoursAvailable: number | null;
  skills: string | null;
  active: boolean;
};

export function EditUserForm({ user, isMe }: { user: U; isMe: boolean }) {
  const [state, action] = useActionState(updateUserAction.bind(null, user.id), {});
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="email" value={user.email} />
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-bold">{user.email}</span>
        {isMe && <span className="text-sm text-muted">c&apos;est toi</span>}
        {!user.active && <span className="text-sm text-brick">accès suspendu</span>}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="field">
          <span>Nom affiché</span>
          <input className="input" name="name" required defaultValue={user.name} />
        </label>
        <label className="field">
          <span>Rôle</span>
          <select className="input" name="role" defaultValue={user.role}>
            <option value="membre">Membre</option>
            <option value="admin">Administrateur</option>
          </select>
        </label>
        <label className="field">
          <span>Heures dispo / semaine</span>
          <input className="input num" name="weeklyHoursAvailable" inputMode="decimal" defaultValue={fmtNum(user.weeklyHoursAvailable)} />
        </label>
        <label className="field">
          <span>Compétences</span>
          <input className="input" name="skills" defaultValue={user.skills ?? ""} />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="active" defaultChecked={user.active} className="size-5 accent-[var(--moss)]" />
        Accès actif
      </label>
      <FormError error={state.error} />
      <div className="flex items-center gap-3">
        <Submit className="btn btn-ghost">Enregistrer</Submit>
        {state.ok && (
          <span role="status" className="text-sm text-moss">
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}

export function AddUserForm() {
  const [state, action] = useActionState(createUserAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 rounded-xl bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span>Adresse e-mail (compte Google)</span>
          <input className="input" type="email" name="email" required />
        </label>
        <label className="field">
          <span>Nom affiché</span>
          <input className="input" name="name" required />
        </label>
        <label className="field">
          <span>Rôle</span>
          <select className="input" name="role" defaultValue="membre">
            <option value="membre">Membre</option>
            <option value="admin">Administrateur</option>
          </select>
        </label>
        <label className="field">
          <span>Heures dispo / semaine</span>
          <input className="input num" name="weeklyHoursAvailable" inputMode="decimal" />
        </label>
      </div>
      <FormError error={state.error} />
      <div className="flex items-center gap-3">
        <Submit>Autoriser</Submit>
        {state.ok && (
          <span role="status" className="text-sm text-moss">
            Accès ajouté
          </span>
        )}
      </div>
    </form>
  );
}
