"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addLinkAction, deleteLinkAction } from "@/app/actions";
import { FormError, Submit } from "./submit";

export type LinkItem = { id: string; url: string; title: string };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export type AttachmentOwnerRef = { kind: "objets" | "taches"; id: string };

export function ObjectLinks({ owner, links }: { owner: AttachmentOwnerRef; links: LinkItem[] }) {
  const [state, action] = useActionState(addLinkAction.bind(null, owner), {});
  const form = useRef<HTMLFormElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <div className="grid gap-3">
      {links.length > 0 && (
        <ul className="rounded-xl bg-surface px-4">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-bold text-moss underline-offset-4 hover:underline"
                >
                  {l.title}
                </a>
                <p className="truncate text-sm text-muted">{host(l.url)}</p>
              </div>
              {confirmId === l.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Supprimer ce lien ?</span>
                  <button
                    type="button"
                    className="btn btn-danger min-h-9 px-3 text-sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteLinkAction(l.id);
                        if (r.error) setError(r.error);
                        setConfirmId(null);
                      })
                    }
                  >
                    Oui, supprimer
                  </button>
                  <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setConfirmId(null)}>
                    Non
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost min-h-9 px-3 text-sm"
                  aria-label={`Supprimer le lien ${l.title}`}
                  onClick={() => setConfirmId(l.id)}
                >
                  Supprimer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={action} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <label className="field">
          <span>Adresse du lien</span>
          <input className="input" name="url" required inputMode="url" placeholder="https://…" autoComplete="off" />
        </label>
        <label className="field">
          <span>Titre (facultatif)</span>
          <input className="input" name="title" maxLength={200} placeholder="Notice, garantie…" />
        </label>
        <Submit className="btn btn-ghost" pendingLabel="Ajout…">
          Ajouter le lien
        </Submit>
      </form>
      <FormError error={state.error ?? error ?? undefined} />
    </div>
  );
}
