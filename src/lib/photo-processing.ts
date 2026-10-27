import "server-only";
import sharp, { type Metadata } from "sharp";

// Mêmes dimensions que l'envoi depuis le navigateur (photo-uploader.tsx)
export const FULL_MAX = 1600;
export const THUMB_MAX = 400;
export const PHOTO_INPUT_MAX = 10 * 1024 * 1024; // 10 Mo

export class ImageError extends Error {}

/** Décode une image (JPEG, PNG, WebP, GIF, HEIF…), la redresse et produit la photo et sa vignette en JPEG. */
export async function processImage(input: Uint8Array) {
  if (input.byteLength === 0) throw new ImageError("Image vide");
  if (input.byteLength > PHOTO_INPUT_MAX) throw new ImageError("Image trop lourde (10 Mo maximum)");
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ImageError("Ce fichier n'est pas une image reconnue");
  }
  if (!meta.width || !meta.height || meta.width * meta.height > 100_000_000) throw new ImageError("Image invalide ou trop grande");
  const base = () => sharp(input, { failOn: "error" }).rotate().flatten({ background: "#ffffff" });
  const [full, thumb] = await Promise.all([
    base().resize(FULL_MAX, FULL_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true }),
    base().resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer(),
  ]);
  return { full: full.data, thumb, width: full.info.width, height: full.info.height };
}

/** Accepte du base64 brut ou une adresse data:image/…;base64,… */
export function decodeBase64Image(raw: string): Uint8Array {
  const b64 = raw.trim().replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw new ImageError("Base64 invalide");
  return Buffer.from(b64, "base64");
}
