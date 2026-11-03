"use client";

import { useActionState, useRef, useState } from "react";
import { saveObjectDescriptionAction } from "@/app/actions";
import { aiCompleteObjectDescriptionAction } from "@/app/ai-actions";
import type { PhotoTarget } from "@/lib/photo-upload";
import { RichTextEditor, type RichTextApi } from "./rich-text-editor";
import { FormError, Submit } from "./submit";
import { DescriptionAssist, ObjectTaskAssist, type AiChoice } from "./task-ai";

/** Description d'un objet, modifiable directement sur sa fiche, avec les aides IA. */
export function ObjectDescription({
  objectId,
  name,
  description,
  images,
  ai,
  isAdmin,
}: {
  objectId: string;
  name: string;
  description: string | null;
  images: PhotoTarget;
  ai: AiChoice;
  isAdmin: boolean;
}) {
  const [state, action] = useActionState(saveObjectDescriptionAction.bind(null, objectId), {});
  const editor = useRef<RichTextApi | null>(null);
  const [dirty, setDirty] = useState(false);

  return (
    <form
      action={action}
      className="grid max-w-2xl gap-3"
      onSubmit={() => setDirty(false)}
    >
      <RichTextEditor
        name="description"
        label="Description"
        placeholder="Caractéristiques, état, points à vérifier…"
        defaultValue={description}
        apiRef={editor}
        commandContext={{ titre: name, objet: name }}
        images={images}
        onChange={() => setDirty(true)}
      />
      <DescriptionAssist
        complete={(draft, provider) => aiCompleteObjectDescriptionAction(objectId, draft, provider)}
        ai={ai}
        isAdmin={isAdmin}
        editor={editor}
        label="Rédiger ou mettre à niveau la description"
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
