"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deletePhotoAction, setCoverPhotoAction } from "@/app/actions";

export type GalleryPhoto = { id: string; isCover: boolean; width: number | null; height: number | null };

export function PhotoGallery({ photos, label }: { photos: GalleryPhoto[]; label: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = photos.find((p) => p.id === openId) ?? null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (current && !d.open) d.showModal();
    if (!current && d.open) d.close();
  }, [current]);

  const close = () => {
    setOpenId(null);
    setConfirmDelete(false);
    setError(null);
  };

  if (photos.length === 0) return null;

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {photos.map((p) => (
          <li key={p.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId(p.id)}
              className="block aspect-square w-full overflow-hidden rounded-lg bg-moss-soft"
              aria-label={`Agrandir la photo${p.isCover ? " (vignette)" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${p.id}?v=1`} alt="" loading="lazy" className="size-full object-cover" />
            </button>
            {p.isCover && (
              <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-moss px-1.5 text-xs font-bold text-surface">
                Vignette
              </span>
            )}
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        onClose={close}
        aria-label={`Photo de ${label}`}
        className="m-auto w-[min(96vw,64rem)] rounded-xl bg-surface p-0 text-ink backdrop:bg-black/70"
      >
        {current && (
          <div className="grid gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${current.id}`}
              alt={`Photo de ${label}`}
              width={current.width ?? undefined}
              height={current.height ?? undefined}
              className="max-h-[75vh] w-full rounded-lg bg-moss-soft object-contain"
            />
            {error && (
              <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {current.isCover ? (
                <span className="text-sm font-bold text-moss">Cette photo est la vignette</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await setCoverPhotoAction(current.id);
                      if (r.error) setError(r.error);
                    })
                  }
                >
                  Utiliser comme vignette
                </button>
              )}
              {confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Supprimer définitivement cette photo ?</span>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deletePhotoAction(current.id);
                        if (r.error) setError(r.error);
                        else close();
                      })
                    }
                  >
                    Oui, supprimer
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                    Non
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                  Supprimer
                </button>
              )}
              <button type="button" className="btn btn-ghost ml-auto" onClick={close}>
                Fermer
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
