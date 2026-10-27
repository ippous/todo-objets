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

/** Images contenues dans un presse-papiers (fichiers copiés ou image copiée depuis une page / une capture). */
function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files).filter((f) => f.type.startsWith("image/"));
  if (fromFiles.length) return fromFiles;
  return Array.from(data.items)
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

/** Vrai si le collage vise une zone de saisie (on laisse alors le navigateur faire). */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["file", "button", "submit", "checkbox", "radio"].includes((el as HTMLInputElement).type);
  return false;
}

const pastedName = (type: string, i: number) => {
  const ext = type.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "png";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `collage-${stamp}${i ? `-${i + 1}` : ""}.${ext}`;
};

export function PhotoUploader({ kind, ownerId, prefix, mode }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  // "native" : téléphone/tablette tactile (appareil photo du système) ; "webcam" : PC avec caméra ; null : aucune
  const [camera, setCamera] = useState<"native" | "webcam" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const media = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- détection des capacités du navigateur, après hydratation
    setCamera(touch ? "native" : media ? "webcam" : null);
    setCanReadClipboard(window.isSecureContext && typeof navigator.clipboard?.read === "function");
  }, []);

  // Collage (Ctrl+V / Cmd+V) d'une ou plusieurs images n'importe où sur la page, hors zones de saisie
  const onFilesRef = useRef<(files: File[]) => void>(() => {});
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const images = imagesFrom(e.clipboardData);
      if (!images.length) return;
      e.preventDefault();
      onFilesRef.current(images);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
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

  useEffect(() => {
    onFilesRef.current = (files) => {
      if (!busy) void onFiles(files);
    };
  });

  async function pasteFromButton() {
    setError(null);
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], pastedName(type, files.length), { type }));
      }
      if (!files.length) {
        setError("Le presse-papiers ne contient pas d'image. Copie d'abord une image (capture d'écran, image d'une page…).");
        return;
      }
      await onFiles(files);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setError(
        name === "NotAllowedError"
          ? "Le navigateur refuse l'accès au presse-papiers. Autorise-le, ou utilise Ctrl+V (Cmd+V sur Mac) sur la page."
          : "Impossible de lire le presse-papiers. Essaie Ctrl+V (Cmd+V sur Mac) sur la page.",
      );
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
        {canReadClipboard && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void pasteFromButton()}>
            Coller une image
          </button>
        )}
      </div>
      {camera !== "native" && (
        <p className="text-sm text-muted">Astuce : tu peux aussi coller une image copiée avec Ctrl+V (Cmd+V sur Mac).</p>
      )}
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
