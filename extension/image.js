// Préparation des images avant envoi : même taille que celle stockée par le serveur (1600 px, JPEG).
// Réduire ici garde la requête bien sous la limite de 4,5 Mo de Vercel, quelle que soit la photo d'origine.

export const MAX_SIDE = 1600;

export class ImageError extends Error {}

/** @param {Blob} blob @returns {Promise<{dataUrl: string, width: number, height: number}>} */
export async function prepareImage(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new ImageError("Image illisible par le navigateur (format HEIC ?). Convertis-la en JPEG ou PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return { dataUrl: await blobToDataUrl(out), width, height };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Origine à autoriser pour lire une image d'un autre site (ex. https://cdn.exemple.fr/*). */
export const originPattern = (url) => `${new URL(url).origin}/*`;

/**
 * Télécharge une image d'une page. Sans accès au site, seules les images servies avec CORS passent ;
 * sinon `needsPermission` est levé pour proposer l'autorisation du site.
 */
export async function fetchImage(url) {
  if (url.startsWith("data:")) return (await fetch(url)).blob();
  if (!/^https?:/i.test(url)) throw new ImageError("Cette image ne peut pas être récupérée (adresse non web).");
  const granted = await chrome.permissions.contains({ origins: [originPattern(url)] });
  let res;
  try {
    res = await fetch(url, { credentials: granted ? "include" : "same-origin" });
  } catch {
    if (!granted) throw Object.assign(new ImageError("Accès au site nécessaire pour lire cette image."), { needsPermission: true });
    throw new ImageError("Impossible de télécharger l'image.");
  }
  if (!res.ok) throw new ImageError(`Impossible de télécharger l'image (${res.status}).`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/") && blob.type) throw new ImageError("Le contenu récupéré n'est pas une image.");
  return blob;
}
