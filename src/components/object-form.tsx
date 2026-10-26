"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ActionState } from "@/lib/forms";
import { FormError, Submit } from "./submit";

type Values = { name: string; type: string | null; description: string | null; location: string | null; tags: string[] };

export function ObjectForm({
  action,
  values,
  parentId,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  parentId?: string | null;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid max-w-xl gap-4">
      {parentId !== undefined && <input type="hidden" name="parentId" value={parentId ?? ""} />}
      <label className="field">
        <span>Nom</span>
        <input className="input" name="name" required maxLength={120} defaultValue={values?.name} autoFocus />
      </label>
      <label className="field">
        <span>Type (propriété, bâtiment, pièce, véhicule, machine…)</span>
        <input className="input" name="type" maxLength={60} defaultValue={values?.type ?? ""} list="types-objet" />
        <datalist id="types-objet">
          {["propriété", "bâtiment", "pièce", "terrain", "véhicule", "machine", "équipement", "projet"].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Description (surface, matériaux, accès, état…)</span>
        <textarea className="input" name="description" maxLength={4000} defaultValue={values?.description ?? ""} />
      </label>
      <label className="field">
        <span>Emplacement</span>
        <input className="input" name="location" maxLength={200} defaultValue={values?.location ?? ""} />
      </label>
      <label className="field">
        <span>Tags, séparés par des virgules</span>
        <input className="input" name="tags" defaultValue={values?.tags.join(", ") ?? ""} />
      </label>
      <FormError error={state.error} />
      <div className="flex gap-2">
        <Submit>{submitLabel}</Submit>
        <Link href={cancelHref} className="btn btn-ghost">
          Annuler
        </Link>
      </div>
    </form>
  );
}
