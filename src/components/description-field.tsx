"use client";

// Zone de saisie d'une description, la même partout (objets et tâches, création comme modification) :
// texte enrichi façon Markdown, cases à cocher, images dans le texte, commandes $$ / @@
// et aide IA pour rédiger ou compléter le texte.
import { useEffect, useRef, useState, type RefObject } from "react";
import { aiCompleteDescriptionAction } from "@/app/ai-actions";
import type { PhotoTarget } from "@/lib/photo-upload";
import type { CommandContext } from "@/lib/command-runtime";
import { RichTextEditor, type RichTextApi } from "./rich-text-editor";
import { DescriptionAssist, type AiChoice } from "./task-ai";

export type DescriptionFieldProps = {
  /** Ce que décrit le texte ; id null pendant la création. */
  owner: { kind: "objet" | "tache"; id: string | null };
  /** Stockage des images (préfixe d'environnement et mode Blob ou local). */
  storage: { prefix: string; mode: "blob" | "local" };
  ai: AiChoice;
  isAdmin: boolean;
  defaultValue?: string | null;
  placeholder?: string;
  commandContext?: CommandContext;
  apiRef?: RefObject<RichTextApi | null>;
  onChange?: () => void;
  name?: string;
  label?: string;
};

export function DescriptionField({
  owner,
  storage,
  ai,
  isAdmin,
  defaultValue,
  placeholder,
  commandContext,
  apiRef,
  onChange,
  name = "description",
  label = "Description",
}: DescriptionFieldProps) {
  const ownRef = useRef<RichTextApi | null>(null);
  const editor = apiRef ?? ownRef;

  // Élément pas encore créé : les images sont rangées sous un identifiant de brouillon,
  // envoyé avec le formulaire puis rattaché à l'objet ou à la tâche à sa création.
  const [draftId, setDraftId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- identifiant tiré au hasard, côté navigateur seulement
    if (!owner.id) setDraftId(crypto.randomUUID());
  }, [owner.id]);

  const images: PhotoTarget | undefined = owner.id
    ? { kind: owner.kind === "objet" ? "objets" : "taches", ownerId: owner.id, ...storage }
    : draftId
      ? { kind: "brouillons", ownerId: draftId, ...storage }
      : undefined;

  return (
    <div className="grid gap-2">
      {!owner.id && draftId && <input type="hidden" name="draftId" value={draftId} />}
      <RichTextEditor
        name={name}
        label={label}
        placeholder={placeholder}
        defaultValue={defaultValue}
        apiRef={editor}
        commandContext={commandContext}
        images={images}
        onChange={onChange}
      />
      <DescriptionAssist
        complete={(draft, provider) => aiCompleteDescriptionAction(owner.kind, owner.id, draft, provider)}
        ai={ai}
        isAdmin={isAdmin}
        editor={editor}
        label={owner.kind === "objet" ? "Rédiger ou mettre à niveau la description" : "Compléter la description"}
      />
    </div>
  );
}
