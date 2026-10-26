import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";

/**
 * Stockage des photos.
 * - Sur Vercel : Vercel Blob en accès privé (BLOB_READ_WRITE_TOKEN).
 * - En local et pour les tests : dossier ./.uploads.
 * Les fichiers ne sont jamais servis directement : ils passent par /api/photos/[id],
 * qui vérifie la session.
 */
export const storageMode: "blob" | "local" = process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";

/** Préfixe par environnement : dev et prod partagent le magasin sans se mélanger. */
export const storagePrefix = process.env.VERCEL_ENV ?? "local";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^${storagePrefix}/(objets|taches)/(${UUID})/(${UUID})(-v)?\\.jpg$`);

export type ParsedPath = { kind: "objets" | "taches"; ownerId: string; fileId: string; thumb: boolean };

/** Vérifie qu'un chemin a la forme attendue et appartient à cet environnement. */
export function parsePhotoPath(pathname: string): ParsedPath | null {
  const m = PATH_RE.exec(pathname);
  if (!m) return null;
  return { kind: m[1] as ParsedPath["kind"], ownerId: m[2], fileId: m[3], thumb: Boolean(m[4]) };
}

const DOC_RE = new RegExp(`^${storagePrefix}/documents/(${UUID})/(${UUID})/([A-Za-z0-9._-]{1,100})$`);

/** Chemin d'un document : <env>/documents/<objet>/<id>/<nom-sûr>. */
export function parseDocumentPath(pathname: string): { objectId: string; fileId: string } | null {
  const m = DOC_RE.exec(pathname);
  return m ? { objectId: m[1], fileId: m[2] } : null;
}

const LOCAL_ROOT = resolve(process.cwd(), ".uploads");
const localPath = (pathname: string) => {
  const p = resolve(LOCAL_ROOT, pathname);
  if (!p.startsWith(LOCAL_ROOT + "/")) throw new Error("Chemin invalide");
  return p;
};

export async function saveLocal(pathname: string, data: Uint8Array) {
  const p = localPath(pathname);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

/** Confirme qu'un fichier envoyé existe bien dans le stockage. */
export async function exists(pathname: string): Promise<boolean> {
  if (storageMode === "local") {
    try {
      await stat(localPath(pathname));
      return true;
    } catch {
      return false;
    }
  }
  const { head } = await import("@vercel/blob");
  try {
    await head(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function read(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
  if (storageMode === "local") {
    if (!(await exists(pathname))) return null;
    return Readable.toWeb(createReadStream(localPath(pathname))) as ReadableStream<Uint8Array>;
  }
  const { get } = await import("@vercel/blob");
  const res = await get(pathname, { access: "private" });
  return res && res.statusCode === 200 ? res.stream : null;
}

export async function remove(pathnames: string[]) {
  if (pathnames.length === 0) return;
  try {
    if (storageMode === "local") {
      await Promise.all(pathnames.map((p) => rm(localPath(p), { force: true })));
    } else {
      const { del } = await import("@vercel/blob");
      await del(pathnames);
    }
  } catch (err) {
    // Un fichier orphelin ne doit pas faire échouer la suppression en base
    console.error("[storage] suppression impossible", err);
  }
}

