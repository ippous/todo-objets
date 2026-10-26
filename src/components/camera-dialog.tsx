"use client";

// Prise de photos avec la caméra de l'appareil (webcam sur PC, caméra sur tablette)
// via getUserMedia. Sur téléphone, PhotoUploader préfère l'appareil photo natif.
import { useEffect, useRef, useState } from "react";

type Shot = { file: File; url: string };

function cameraError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "L'accès à la caméra a été refusé. Autorise-le dans les réglages du navigateur (icône à gauche de l'adresse), puis réessaie.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Aucune caméra n'a été trouvée sur cet appareil.";
  if (name === "NotReadableError") return "La caméra est déjà utilisée par une autre application. Ferme-la puis réessaie.";
  return "Impossible d'ouvrir la caméra.";
}

export function CameraDialog({
  open,
  onClose,
  onPhotos,
}: {
  open: boolean;
  onClose: () => void;
  onPhotos: (files: File[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [flash, setFlash] = useState(false);

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  };

  // Ouverture / fermeture de la boîte
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setShots([]);
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Démarrage du flux vidéo (et changement de caméra)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      stop();
      setError(null);
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setReady(true);
        // Les noms des caméras ne sont connus qu'après l'autorisation
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (!cancelled) {
          setDevices(all);
          if (!deviceId) setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId ?? "");
        }
      } catch (err) {
        console.error("[camera]", err);
        if (!cancelled) setError(cameraError(err));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, deviceId]);

  const releasePreviews = () => shots.forEach((s) => URL.revokeObjectURL(s.url));

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = new File([blob], `photo-${stamp}.jpg`, { type: "image/jpeg" });
        setShots((s) => [...s, { file, url: URL.createObjectURL(blob) }]);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
      },
      "image/jpeg",
      0.92,
    );
  }

  function finish() {
    const files = shots.map((s) => s.file);
    releasePreviews();
    setShots([]);
    stop();
    onClose();
    if (files.length) onPhotos(files);
  }

  return (
    <dialog
      ref={dialog}
      onClose={() => {
        releasePreviews();
        setShots([]);
        stop();
        onClose();
      }}
      aria-labelledby="camera-title"
      className="m-auto w-[min(96vw,44rem)] rounded-xl bg-surface p-0 text-ink backdrop:bg-black/60"
    >
      {open && (
        <div className="grid max-h-[94dvh] grid-rows-[auto_1fr_auto]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
            <h2 id="camera-title" className="text-lg font-bold">
              Prendre des photos
            </h2>
            {devices.length > 1 && (
              <label className="flex items-center gap-2 text-sm">
                <span>Caméra</span>
                <select className="input min-h-9 w-auto py-1 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                  {devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Caméra ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="grid gap-3 overflow-auto p-4">
            {error ? (
              <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
                {error}
              </p>
            ) : (
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video
                  ref={video}
                  playsInline
                  muted
                  aria-label="Aperçu de la caméra"
                  className="mx-auto max-h-[55dvh] w-full object-contain"
                />
                {!ready && <p className="absolute inset-0 grid place-items-center text-sm text-white">Ouverture de la caméra…</p>}
                {flash && <div aria-hidden className="absolute inset-0 bg-white/70" />}
              </div>
            )}
            {shots.length > 0 && (
              <div>
                <p role="status" className="mb-2 text-sm text-muted">
                  {shots.length} photo{shots.length > 1 ? "s" : ""} prise{shots.length > 1 ? "s" : ""}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {shots.map((s, i) => (
                    <li key={s.url} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={`Photo prise ${i + 1}`} className="size-20 rounded-lg object-cover" />
                      <button
                        type="button"
                        aria-label={`Retirer la photo ${i + 1}`}
                        className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-ink text-sm text-surface"
                        onClick={() => {
                          URL.revokeObjectURL(s.url);
                          setShots((all) => all.filter((x) => x !== s));
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">
            <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>
              Annuler
            </button>
            <button type="button" className="btn btn-ghost" disabled={!ready} onClick={capture}>
              Déclencher
            </button>
            <button type="button" className="btn btn-primary" disabled={shots.length === 0} onClick={finish}>
              {shots.length > 1 ? `Ajouter les ${shots.length} photos` : "Ajouter la photo"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
