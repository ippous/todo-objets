import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getObject, getTodo } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { parsePhotoPath, saveLocal, storageMode } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024;

/** Envoi en local (développement et tests), quand Vercel Blob n'est pas configuré. */
export async function POST(request: Request) {
  if (storageMode !== "local") return NextResponse.json({ error: "Indisponible" }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const pathname = new URL(request.url).searchParams.get("pathname") ?? "";
  const parsed = parsePhotoPath(pathname);
  if (!parsed) return NextResponse.json({ error: "Chemin de photo invalide" }, { status: 400 });
  const db = getDb();
  const owner = parsed.kind === "objets" ? await getObject(db, parsed.ownerId) : await getTodo(db, parsed.ownerId);
  if (!owner) return NextResponse.json({ error: "Objet ou tâche introuvable" }, { status: 404 });
  if (request.headers.get("content-type") !== "image/jpeg") {
    return NextResponse.json({ error: "Format non accepté" }, { status: 415 });
  }
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Taille non acceptée" }, { status: 413 });
  }
  await saveLocal(pathname, data);
  return NextResponse.json({ pathname });
}
