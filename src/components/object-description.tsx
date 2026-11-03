"use client";

import { useActionState, useState } from "react";
import { saveObjectDescriptionAction } from "@/app/actions";
import { DescriptionField, type DescriptionFieldProps } from "./description-field";
import { FormError, Submit } from "./submit";
import { ObjectTaskAssist, type AiChoice } from "./task-ai";

/** Description d'un objet, modifiable directement sur sa fiche, avec les aides IA. */
export function ObjectDescription({
  objectId,
  name,
  description,
  storage,
  ai,
  isAdmin,
}: {
  objectId: string;
  name: string;
  description: string | null;
  storage: DescriptionFieldProps["storage"];
  ai: AiChoice;
  isAdmin: boolean;
}) {
  const [state, action] = useActionState(saveObjectDescriptionAction.bind(null, objectId), {});
  const [dirty, setDirty] = useState(false);

  return (
    <form action={action} className="grid max-w-2xl gap-3" onSubmit={() => setDirty(false)}>
      <DescriptionField
        owner={{ kind: "objet", id: objectId }}
        storage={storage}
        ai={ai}
        isAdmin={isAdmin}
        defaultValue={description}
        placeholder="Caractéristiques, état, points à vérifier…"
        commandContext={{ titre: name, objet: name }}
        onChange={() => setDirty(true)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Submit className="btn btn-primary">Enregistrer la description</Submit>
        {dirty ? (
          <span className="text-sm text-muted">Modifications non enregistrées</span>
        ) : (
          state.ok && (
            <span role="status" className="text-sm text-moss">
              Description enregistrée.
            </span>
          )
        )}
      </div>
      <FormError error={state.error} />
      <ObjectTaskAssist objectId={objectId} ai={ai} isAdmin={isAdmin} />
    </form>
  );
}
