"use client";

import { useEffect, useRef, useState } from "react";
import { addPhotoAction } from "@/app/actions";
import { CameraDialog } from "./camera-dialog";

type Props = {
  kind: "objets" | "taches";
  ownerId: string;
  prefix: string;
  mode: "blob" | "local";
};

const FULL_MAX = 1600;
const THUMB_MAX = 400;

/** Redimensionne une image (orientation EXIF respectée) en JPEG. */
async function resize(file: File, max: number, quality: number) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob>((ok, ko) =>
    canvas.toBlob((b) => (b ? ok(b) : ko(new Error("Conversion impossible"))), "image/jpeg", quality),
  );
  return { blob, width: w, height: h };
}

async function send(mode: Props["mode"], pathname: string, blob: Blob) {
  if (mode === "local") {
    const res = await fetch(`/api/photos/local-upload?pathname=${encodeURIComponent(pathname)}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Envoi refusé");
    return;
  }
  const { upload } = await import("@vercel/blob/client");
  await upload(pathname, blob, {
    access: "private",
    handleUploadUrl: "/api/photos/upload",
    contentType: "image/jpeg",
  });
}

export function PhotoUploader({ kind, ownerId, prefix, mode }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  // "native" : téléphone/tablette tactile (appareil photo du système) ; "webcam" : PC avec caméra ; null : aucune
  const [camera, setCamera] = useState<"native" | "webcam" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const media = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- détection des capacités du navigateur, après hydratation
    setCamera(touch ? "native" : media ? "webcam" : null);
  }, []);

  // Fichiers choisis avant que la page soit interactive (réseau lent) : on les traite à l'hydratation
  useEffect(() => {
    const files = input.current?.files;
    if (files?.length) void onFiles(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uniquement au montage
  }, []);

  async function onFiles(list: FileList | File[] | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    setBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const file of files) {
        setStatus(`Envoi de la photo ${done + 1} sur ${files.length}…`);
        if (!file.type.startsWith("image/")) throw new Error(`« ${file.name} » n'est pas une image`);
        const [full, thumb] = await Promise.all([resize(file, FULL_MAX, 0.82), resize(file, THUMB_MAX, 0.75)]);
        const id = crypto.randomUUID();
        const base = `${prefix}/${kind}/${ownerId}/${id}`;
        await send(mode, `${base}.jpg`, full.blob);
        await send(mode, `${base}-v.jpg`, thumb.blob);
        const res = await addPhotoAction({
          pathname: `${base}.jpg`,
          thumbPathname: `${base}-v.jpg`,
          width: full.width,
          height: full.height,
        });
        if (res.error) throw new Error(res.error);
        done++;
      }
      setStatus(done > 1 ? `${done} photos ajoutées` : "Photo ajoutée");
    } catch (err) {
      setStatus(null);
      setError((err as Error).message || "L'envoi a échoué. Réessaie.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      if (nativeCamera.current) nativeCamera.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <label className={`btn btn-ghost w-fit cursor-pointer ${busy ? "opacity-60" : ""}`}>
          {busy ? "Envoi en cours…" : "Ajouter des photos"}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {camera === "native" && (
          <label className={`btn btn-ghost w-fit cursor-pointer ${busy ? "opacity-60" : ""}`}>
            Prendre une photo
            <input
              ref={nativeCamera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        )}
        {camera === "webcam" && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCameraOpen(true)}>
            Prendre une photo
          </button>
        )}
      </div>
      {camera === "webcam" && (
        <CameraDialog open={cameraOpen} onClose={() => setCameraOpen(false)} onPhotos={(files) => void onFiles(files)} />
      )}
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
