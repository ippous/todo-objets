"use client";

import { useActionState, useEffect, useRef } from "react";
import { setStatusAction } from "@/app/actions";
import { fmtNum } from "@/lib/format";
import { FormError, Submit } from "./submit";

type Status = "a_faire" | "en_cours" | "fait";

export function QuickStatus({
  id,
  status,
  estHours,
  estValueEur,
  recurring,
}: {
  id: string;
  status: Status;
  estHours: number | null;
  estValueEur: number | null;
  recurring: boolean;
}) {
  const [state, action] = useActionState(setStatusAction.bind(null, id), {});
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (state.ok && detailsRef.current) detailsRef.current.open = false;
  }, [state]);

  if (status === "fait") {
    return (
      <form action={action}>
        <input type="hidden" name="status" value="a_faire" />
        <Submit className="btn btn-ghost min-h-9 px-3 text-sm" pendingLabel="…">
          Rouvrir
        </Submit>
        <FormError error={state.error} />
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {status === "a_faire" && (
        <form action={action}>
          <input type="hidden" name="status" value="en_cours" />
          <Submit className="btn btn-ghost min-h-9 px-3 text-sm" pendingLabel="…">
            Commencer
          </Submit>
        </form>
      )}
      {status === "en_cours" && <span className="rounded bg-moss-soft px-2 py-1 text-sm font-bold text-moss">En cours</span>}
      <details ref={detailsRef} className="relative">
        <summary className="btn btn-primary min-h-9 cursor-pointer list-none px-3 text-sm">Terminer</summary>
        <form
          action={action}
          className="reveal absolute right-0 z-10 mt-2 grid w-72 gap-3 rounded-xl border border-line bg-surface p-4 shadow-lg"
        >
          <input type="hidden" name="status" value="fait" />
          <p className="text-sm text-muted">Ce qui a été réellement passé et gagné :</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="field">
              <span>Heures</span>
              <input className="input" name="actualHours" inputMode="decimal" defaultValue={fmtNum(estHours)} />
            </label>
            <label className="field">
              <span>Valeur €</span>
              <input className="input" name="actualValueEur" inputMode="decimal" defaultValue={fmtNum(estValueEur)} />
            </label>
          </div>
          {recurring && <p className="text-sm text-muted">La prochaine occurrence sera créée automatiquement.</p>}
          <Submit pendingLabel="…">Marquer comme fait</Submit>
        </form>
      </details>
      <FormError error={state.error} />
    </div>
  );
}
