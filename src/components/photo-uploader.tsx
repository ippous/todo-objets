"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ClipboardPaste, ImagePlus, LoaderCircle } from "lucide-react";
import { uploadPhoto } from "@/lib/photo-upload";
import { IconLabel, Tip } from "./tip";

/** Boutons carrés (icône seule) sur mobile, icône et texte à partir de « sm ». */
const btn = "min-w-11 px-3 sm:px-4";
import { CameraDialog } from "./camera-dialog";

type Props = {
  kind: "objets" | "taches";
  ownerId: string;
  prefix: string;
  mode: "blob" | "local";
};

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
        await uploadPhoto(file, { kind, ownerId, prefix, mode });
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
        <Tip label={busy ? "Envoi en cours…" : "Ajouter des photos"}>
          <label className={`btn btn-ghost ${btn} cursor-pointer ${busy ? "opacity-60" : ""}`}>
            <IconLabel
              icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <ImagePlus size={18} aria-hidden />}
              label={busy ? "Envoi en cours…" : "Ajouter des photos"}
            />
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              aria-label="Ajouter des photos"
              className="sr-only"
              disabled={busy}
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
        </Tip>
        {camera === "native" && (
          <Tip label="Prendre une photo">
            <label className={`btn btn-ghost ${btn} cursor-pointer ${busy ? "opacity-60" : ""}`}>
              <IconLabel icon={<Camera size={18} aria-hidden />} label="Prendre une photo" />
              <input
                ref={nativeCamera}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Prendre une photo"
                className="sr-only"
                disabled={busy}
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
          </Tip>
        )}
        {camera === "webcam" && (
          <Tip label="Prendre une photo">
            <button
              type="button"
              className={`btn btn-ghost ${btn}`}
              aria-label="Prendre une photo"
              disabled={busy}
              onClick={() => setCameraOpen(true)}
            >
              <IconLabel icon={<Camera size={18} aria-hidden />} label="Prendre une photo" />
            </button>
          </Tip>
        )}
        {canReadClipboard && (
          <Tip label="Coller une image">
            <button
              type="button"
              className={`btn btn-ghost ${btn}`}
              aria-label="Coller une image"
              disabled={busy}
              onClick={() => void pasteFromButton()}
            >
              <IconLabel icon={<ClipboardPaste size={18} aria-hidden />} label="Coller une image" />
            </button>
          </Tip>
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
