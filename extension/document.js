// Documents : formats acceptés (les mêmes que Carnet, src/lib/document-types.ts) et préparation de l'envoi.
import { blobToDataUrl } from "./image.js";

/** Requête limitée à 4,5 Mo par Vercel ; le base64 grossit d'un tiers : 3 Mo de fichier au plus. */
export const DOC_MAX_BYTES = 3 * 1024 * 1024;

const BY_EXTENSION = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip",
};
const ACCEPTED_TYPES = new Set(Object.values(BY_EXTENSION));

/** Valeur de l'attribut accept du sélecteur de fichier. */
export const ACCEPT = [...ACCEPTED_TYPES, ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(",");

export class DocumentError extends Error {}

export const extensionOf = (name) => (/\.([a-z0-9]{1,5})$/i.exec(name || "")?.[1] ?? "").toLowerCase();

/** Type MIME accepté par Carnet, ou null. */
export function documentType(name, browserType) {
  if (browserType && ACCEPTED_TYPES.has(browserType)) return browserType;
  return BY_EXTENSION[extensionOf(name)] ?? null;
}

/** L'adresse ressemble-t-elle à un fichier (PDF, Word…) ? */
export function looksLikeDocumentUrl(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !!BY_EXTENSION[extensionOf(decodeURIComponent(u.pathname))];
  } catch {
    return false;
  }
}

/** Nom de fichier tiré d'une adresse (« …/facture-2026.pdf?x=1 » → « facture-2026.pdf »). */
export function fileNameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return last || new URL(url).hostname;
  } catch {
    return "document";
  }
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * Fichier local → document prêt à envoyer en base64.
 * @param {File} file
 */
export async function prepareDocument(file) {
  const type = documentType(file.name, file.type);
  if (!type) throw new DocumentError(`Format non accepté : « ${file.name} » (PDF, Word, Excel, PowerPoint, ODT, ODS, images, texte, CSV, ZIP).`);
  if (file.size === 0) throw new DocumentError("Le fichier est vide.");
  if (file.size > DOC_MAX_BYTES) {
    throw new DocumentError(
      `Fichier trop gros pour l'extension (${formatSize(file.size)}, 3 Mo au plus) : ajoute-le depuis la fiche dans Carnet (25 Mo au plus).`,
    );
  }
  return { kind: "fichier", name: file.name, type, size: file.size, dataUrl: await blobToDataUrl(file) };
}
