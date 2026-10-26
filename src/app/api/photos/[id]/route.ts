import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getPhoto } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { read } from "@/lib/storage";

/** Sert une photo (ou sa vignette avec ?v=1) aux seuls utilisateurs connectés. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/photos/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non connecté", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Introuvable", { status: 404 });

  const photo = await getPhoto(getDb(), id);
  if (!photo) return new NextResponse("Introuvable", { status: 404 });
  const thumb = request.nextUrl.searchParams.get("v") === "1";
  const stream = await read(thumb ? photo.thumbPathname : photo.pathname);
  if (!stream) return new NextResponse("Introuvable", { status: 404 });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "image/jpeg",
      // Fichiers immuables : un identifiant de photo ne change jamais de contenu
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
