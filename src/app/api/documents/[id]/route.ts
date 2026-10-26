import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getDocument } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { read } from "@/lib/storage";

const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"]);

/** Ouvre (PDF, images, texte) ou télécharge un document, pour les seuls utilisateurs connectés. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non connecté", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Introuvable", { status: 404 });
  const doc = await getDocument(getDb(), id);
  if (!doc) return new NextResponse("Introuvable", { status: 404 });
  const stream = await read(doc.pathname);
  if (!stream) return new NextResponse("Introuvable", { status: 404 });

  const download = request.nextUrl.searchParams.get("telecharger") === "1" || !INLINE.has(doc.contentType);
  const ascii = doc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(stream, {
    headers: {
      "Content-Type": doc.contentType === "text/plain" ? "text/plain; charset=utf-8" : doc.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
