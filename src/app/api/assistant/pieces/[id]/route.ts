// Lecture d'une pièce jointe du chat (aperçu), réservée à la personne qui l'a envoyée.
import { getDb } from "@/db";
import { getPieces } from "@/lib/chat-pieces";
import { getCurrentUser } from "@/lib/session";
import { read } from "@/lib/storage";

export async function GET(_: Request, ctx: RouteContext<"/api/assistant/pieces/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Non connecté", { status: 401 });
  const { id } = await ctx.params;
  const [p] = await getPieces(getDb(), user.id, [id]);
  if (!p) return new Response("Introuvable", { status: 404 });
  const stream = await read(p.pathname);
  if (!stream) return new Response("Introuvable", { status: 404 });
  return new Response(stream, {
    headers: {
      "content-type": p.contentType,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(p.filename)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "cache-control": "private, max-age=3600",
    },
  });
}
