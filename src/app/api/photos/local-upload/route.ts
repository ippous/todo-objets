import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from "@/lib/document-types";
import { getObject, getTodo } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { parseDocumentPath, parsePhotoPath, saveLocal, storageMode } from "@/lib/storage";

const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Envoi en local (développement et tests), quand Vercel Blob n'est pas configuré.
 * Sert aux photos comme aux documents.
 */
export async function POST(request: Request) {
  if (storageMode !== "local") return NextResponse.json({ error: "Indisponible" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const pathname = new URL(request.url).searchParams.get("pathname") ?? "";
  const type = request.headers.get("content-type") ?? "";
  const db = getDb();
  let max: number;

  const photo = parsePhotoPath(pathname);
  const doc = photo ? null : parseDocumentPath(pathname);
  if (photo) {
    const owner = photo.kind === "objets" ? await getObject(db, photo.ownerId) : await getTodo(db, photo.ownerId);
    if (!owner) return NextResponse.json({ error: "Objet ou tâche introuvable" }, { status: 404 });
    if (type !== "image/jpeg") return NextResponse.json({ error: "Format non accepté" }, { status: 415 });
    max = PHOTO_MAX_BYTES;
  } else if (doc) {
    if (!(await getObject(db, doc.objectId))) return NextResponse.json({ error: "Objet introuvable" }, { status: 404 });
    if (!DOCUMENT_TYPES[type]) return NextResponse.json({ error: "Format non accepté" }, { status: 415 });
    max = DOCUMENT_MAX_BYTES;
  } else {
    return NextResponse.json({ error: "Chemin invalide" }, { status: 400 });
  }

  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > max) {
    return NextResponse.json({ error: "Taille non acceptée" }, { status: 413 });
  }
  await saveLocal(pathname, data);
  return NextResponse.json({ pathname });
}
