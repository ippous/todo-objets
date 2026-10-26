"use client";

import { useRef, useState, useTransition } from "react";
import { addDocumentAction, deleteDocumentAction } from "@/app/actions";
import { ACCEPT_ATTR, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, documentType, formatSize, safeFileName } from "@/lib/document-types";

export type DocItem = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
};

const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });

async function send(mode: "blob" | "local", pathname: string, file: File, contentType: string) {
  if (mode === "local") {
    const res = await fetch(`/api/photos/local-upload?pathname=${encodeURIComponent(pathname)}`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: file,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Envoi refusé");
    return;
  }
  const { upload } = await import("@vercel/blob/client");
  await upload(pathname, file, { access: "private", handleUploadUrl: "/api/documents/upload", contentType });
}

export function ObjectDocuments({
  objectId,
  docs,
  prefix,
  mode,
}: {
  objectId: string;
  docs: DocItem[];
  prefix: string;
  mode: "blob" | "local";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        setStatus(`Envoi de « ${file.name} »…`);
        const type = documentType(file.name, file.type);
        if (!type) throw new Error(`« ${file.name} » : ce type de fichier n'est pas accepté`);
        if (file.size > DOCUMENT_MAX_BYTES) throw new Error(`« ${file.name} » dépasse 25 Mo`);
        if (file.size === 0) throw new Error(`« ${file.name} » est vide`);
        const pathname = `${prefix}/documents/${objectId}/${crypto.randomUUID()}/${safeFileName(file.name)}`;
        await send(mode, pathname, file, type);
        const r = await addDocumentAction({ pathname, filename: file.name, contentType: type, size: file.size });
        if (r.error) throw new Error(r.error);
        done++;
      }
      setStatus(done > 1 ? `${done} documents ajoutés` : "Document ajouté");
    } catch (err) {
      setStatus(done ? `${done} document${done > 1 ? "s" : ""} ajouté${done > 1 ? "s" : ""}` : null);
      setError((err as Error).message || "L'envoi a échoué. Réessaie.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-3">
      {docs.length > 0 && (
        <ul className="rounded-xl bg-surface px-4">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-moss-soft text-xs font-bold text-moss">
                {(DOCUMENT_TYPES[d.contentType] ?? "Fichier").split(" ")[0].slice(0, 5)}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/documents/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="block truncate font-bold underline-offset-4 hover:underline"
                >
                  {d.filename}
                </a>
                <p className="num text-sm text-muted">
                  {formatSize(d.size)} · {day.format(new Date(d.createdAt))}
                  {d.createdBy ? ` · ${d.createdBy}` : ""}
                </p>
              </div>
              {confirmId === d.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Supprimer ce document ?</span>
                  <button
                    type="button"
                    className="btn btn-danger min-h-9 px-3 text-sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteDocumentAction(d.id);
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
                <span className="flex gap-2">
                  <a href={`/api/documents/${d.id}?telecharger=1`} className="btn btn-ghost min-h-9 px-3 text-sm">
                    Télécharger
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost min-h-9 px-3 text-sm"
                    aria-label={`Supprimer ${d.filename}`}
                    onClick={() => setConfirmId(d.id)}
                  >
                    Supprimer
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className={`btn btn-ghost w-fit cursor-pointer ${busy ? "opacity-60" : ""}`}>
        {busy ? "Envoi en cours…" : "Ajouter des documents"}
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          disabled={busy}
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>
      <p className="text-sm text-muted">PDF, Word, Excel, PowerPoint, images, texte ou ZIP, 25 Mo au plus par fichier.</p>
      {status && (
        <p role="status" className="text-sm text-moss">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
          {error}
        </p>
      )}
    </div>
  );
}
