"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ActionState } from "@/lib/forms";
import { DescriptionField, type DescriptionFieldProps } from "./description-field";
import type { AiChoice } from "./task-ai";
import { FormError, Submit } from "./submit";

type Values = { name: string; typeId: string | null; description: string | null; location: string | null; tags: string[] };

export function ObjectForm({
  action,
  values,
  parentId,
  submitLabel,
  cancelHref,
  types,
  description,
}: {
  types: { id: string; name: string }[];
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  parentId?: string | null;
  submitLabel: string;
  cancelHref: string;
  /** Zone de description : objet décrit (id null à la création), stockage des images, aide IA. */
  description: { objectId: string | null; storage: DescriptionFieldProps["storage"]; ai: AiChoice; isAdmin: boolean };
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
        <span>Type</span>
        <select className="input" name="typeId" defaultValue={values?.typeId ?? ""}>
          <option value="">Sans type</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Link href="/types" className="w-fit text-sm text-moss underline-offset-4 hover:underline">
          Gérer les types
        </Link>
      </label>
      <DescriptionField
        owner={{ kind: "objet", id: description.objectId }}
        storage={description.storage}
        ai={description.ai}
        isAdmin={description.isAdmin}
        placeholder="Surface, matériaux, accès, état…"
        defaultValue={values?.description}
        commandContext={{ titre: values?.name ?? null, objet: values?.name ?? null }}
      />
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
