import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getObject, getTodo } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { parsePhotoPath } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024;

/** Délivre un jeton d'envoi direct vers Vercel Blob (accès privé), après contrôle de la session. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const parsed = parsePhotoPath(pathname);
        if (!parsed) throw new Error("Chemin de photo invalide");
        const db = getDb();
        const owner = parsed.kind === "objets" ? await getObject(db, parsed.ownerId) : await getTodo(db, parsed.ownerId);
        if (!owner) throw new Error("Objet ou tâche introuvable");
        return {
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
