"use client";

import { useActionState } from "react";
import { FormError, Submit } from "@/components/submit";
import type { ActionState } from "@/lib/forms";
import type { ObjectOption } from "@/lib/options";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

export function MoveObject({
  action,
  options,
  currentParentId,
}: {
  action: Action;
  options: ObjectOption[];
  currentParentId: string | null;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-3">
      <label className="field">
        <span>Nouveau parent</span>
        <select className="input" name="parentId" defaultValue={currentParentId ?? "racine"}>
          <option value="racine">Aucun (devient une racine)</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <FormError error={state.error} />
      <div>
        <Submit className="btn btn-ghost" pendingLabel="Déplacement…">
          Déplacer
        </Submit>
      </div>
    </form>
  );
}

export function DeleteObject({ action, parentId, name }: { action: Action; parentId: string | null; name: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Supprimer définitivement « ${name} » ?`)) e.preventDefault();
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="parentId" value={parentId ?? ""} />
      <FormError error={state.error} />
      <div>
        <Submit className="btn btn-danger" pendingLabel="Suppression…">
          Supprimer l&apos;objet
        </Submit>
      </div>
    </form>
  );
}
