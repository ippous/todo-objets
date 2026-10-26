"use client";

import { useActionState } from "react";
import { FormError, Submit } from "@/components/submit";
import type { ActionState } from "@/lib/forms";

export function DeleteTodo({
  action,
  returnTo,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  returnTo: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("Supprimer définitivement cette tâche ?")) e.preventDefault();
      }}
      className="grid max-w-2xl gap-2 border-t border-line pt-6"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <FormError error={state.error} />
      <div>
        <Submit className="btn btn-danger" pendingLabel="Suppression…">
          Supprimer la tâche
        </Submit>
      </div>
    </form>
  );
}
