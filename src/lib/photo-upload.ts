// Envoi d'une photo depuis le navigateur : redimensionnement, dépôt du fichier et de sa vignette,
// puis enregistrement en base. Sert à la galerie et aux images insérées dans les descriptions.
import { addPhotoAction } from "@/app/actions";

export type PhotoTarget = { kind: "objets" | "taches"; ownerId: string; prefix: string; mode: "blob" | "local" };

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

async function send(mode: PhotoTarget["mode"], pathname: string, blob: Blob) {
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

/** Envoie une image et renvoie l'identifiant de la photo créée. */
export async function uploadPhoto(file: File, target: PhotoTarget & { inline?: boolean }): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`« ${file.name} » n'est pas une image`);
  const [full, thumb] = await Promise.all([resize(file, FULL_MAX, 0.82), resize(file, THUMB_MAX, 0.75)]);
  const id = crypto.randomUUID();
  const base = `${target.prefix}/${target.kind}/${target.ownerId}/${id}`;
  await send(target.mode, `${base}.jpg`, full.blob);
  await send(target.mode, `${base}-v.jpg`, thumb.blob);
  const res = await addPhotoAction({
    pathname: `${base}.jpg`,
    thumbPathname: `${base}-v.jpg`,
    width: full.width,
    height: full.height,
    inline: target.inline,
  });
  if (res.error || !res.id) throw new Error(res.error ?? "Envoi refusé");
  return res.id;
}
