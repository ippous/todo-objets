"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Todo } from "@/db/schema";
import { CATEGORY_LABEL, fmtNum, PRIORITY_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "@/lib/format";
import type { ActionState } from "@/lib/forms";
import type { ObjectOption } from "@/lib/options";
import { FormError, Submit } from "./submit";

type Values = Pick<
  Todo,
  | "objectId"
  | "title"
  | "description"
  | "category"
  | "priority"
  | "status"
  | "estHours"
  | "actualHours"
  | "estValueEur"
  | "actualValueEur"
  | "dueDate"
  | "recurrence"
  | "assigneeId"
  | "tags"
>;

export function TodoForm({
  action,
  values,
  objectId,
  objects,
  users,
  returnTo,
  submitLabel,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  objectId?: string;
  objects: ObjectOption[];
  users: { id: string; name: string }[];
  returnTo: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [status, setStatus] = useState(values?.status ?? "a_faire");
  const [est, setEst] = useState({ h: fmtNum(values?.estHours), v: fmtNum(values?.estValueEur) });
  const h = Number(est.h.replace(",", "."));
  const v = Number(est.v.replace(",", "."));
  const ratio = h > 0 && v >= 0 && est.v !== "" ? Math.round((v / h) * 100) / 100 : null;

  return (
    <form action={formAction} className="grid max-w-2xl gap-5">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="field">
        <span>Titre</span>
        <input className="input" name="title" required maxLength={200} defaultValue={values?.title} autoFocus={!values} />
      </label>
      <label className="field">
        <span>Objet concerné</span>
        <select className="input" name="objectId" required defaultValue={values?.objectId ?? objectId ?? ""}>
          <option value="" disabled>
            Choisir dans l&apos;arbre…
          </option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Description</span>
        <textarea className="input" name="description" maxLength={8000} defaultValue={values?.description ?? ""} />
      </label>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="sr-only">Classement</legend>
        <label className="field">
          <span>Catégorie</span>
          <select className="input" name="category" defaultValue={values?.category ?? "entretien"}>
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" name="priority" defaultValue={values?.priority ?? "moyenne"}>
            {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Statut</span>
          <select
            className="input"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Values["status"])}
          >
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl bg-surface p-4">
        <legend className="px-1 font-bold">Estimé</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Durée (heures)</span>
            <input
              className="input num"
              name="estHours"
              inputMode="decimal"
              value={est.h}
              onChange={(e) => setEst((s) => ({ ...s, h: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>Valeur (€)</span>
            <input
              className="input num"
              name="estValueEur"
              inputMode="decimal"
              value={est.v}
              onChange={(e) => setEst((s) => ({ ...s, v: e.target.value }))}
            />
          </label>
        </div>
        <p className="num text-sm text-muted" aria-live="polite">
          {ratio != null ? `Soit ${String(ratio).replace(".", ",")} €/h` : "Le ratio €/h s'affiche dès que durée et valeur sont remplies."}
        </p>
      </fieldset>

      <fieldset className={`grid gap-3 rounded-xl p-4 ${status === "fait" ? "bg-moss-soft" : "bg-surface"}`}>
        <legend className="px-1 font-bold">Réalisé</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>Durée (heures)</span>
            <input className="input num" name="actualHours" inputMode="decimal" defaultValue={fmtNum(values?.actualHours)} />
          </label>
          <label className="field">
            <span>Valeur (€)</span>
            <input className="input num" name="actualValueEur" inputMode="decimal" defaultValue={fmtNum(values?.actualValueEur)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="sr-only">Planification</legend>
        <label className="field">
          <span>Échéance</span>
          <input className="input" type="date" name="dueDate" defaultValue={values?.dueDate ?? ""} />
        </label>
        <label className="field">
          <span>Récurrence</span>
          <select className="input" name="recurrence" defaultValue={values?.recurrence ?? "aucune"}>
            {Object.entries(RECURRENCE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Responsable</span>
          <select className="input" name="assigneeId" defaultValue={values?.assigneeId ?? ""}>
            <option value="">Personne</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="field">
        <span>Tags, séparés par des virgules</span>
        <input className="input" name="tags" defaultValue={values?.tags.join(", ") ?? ""} />
      </label>

      <FormError error={state.error} />
      <div className="flex gap-2">
        <Submit>{submitLabel}</Submit>
        <Link href={returnTo} className="btn btn-ghost">
          Annuler
        </Link>
      </div>
    </form>
  );
}
