import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from "@/lib/document-types";
import { getObject } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { parseDocumentPath } from "@/lib/storage";

/** Jeton d'envoi direct d'un document vers Vercel Blob (privé), après contrôle de la session. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const parsed = parseDocumentPath(pathname);
        if (!parsed) throw new Error("Chemin de document invalide");
        if (!(await getObject(getDb(), parsed.objectId))) throw new Error("Objet introuvable");
        return {
          allowedContentTypes: Object.keys(DOCUMENT_TYPES),
          maximumSizeInBytes: DOCUMENT_MAX_BYTES,
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
