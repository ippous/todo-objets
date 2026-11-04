// Pièce jointe au chat de l'assistant : envoi d'un fichier (image ou document), 4 Mo au plus.
import { getDb } from "@/db";
import { pieceInfo, savePiece } from "@/lib/chat-pieces";
import { DomainError } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Fichier manquant" }, { status: 400 });
  try {
    const row = await savePiece(getDb(), user.id, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(pieceInfo(row));
  } catch (err) {
    if (err instanceof DomainError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
