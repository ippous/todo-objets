"use client";

import { useActionState, useState } from "react";
import { saveObjectDescriptionAction } from "@/app/actions";
import { DescriptionField, type DescriptionFieldProps } from "./description-field";
import { Save } from "lucide-react";
import { FormError, Submit } from "./submit";
import { IconLabel, Tip } from "./tip";
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
      {/* Une seule ligne : enregistrer, puis les aides IA pour créer des tâches */}
      <ObjectTaskAssist
        objectId={objectId}
        ai={ai}
        isAdmin={isAdmin}
        quiet
        leading={
          <Tip label="Enregistrer la description">
            <Submit className="btn btn-primary min-w-11 px-3 sm:px-4" ariaLabel="Enregistrer la description" pendingLabel="…">
              <IconLabel icon={<Save size={18} aria-hidden />} label="Enregistrer la description" />
            </Submit>
          </Tip>
        }
      />
      {dirty ? (
        <p className="text-sm text-muted">Modifications non enregistrées</p>
      ) : (
        state.ok && (
          <p role="status" className="text-sm text-moss">
            Description enregistrée.
          </p>
        )
      )}
      <FormError error={state.error} />
    </form>
  );
}
