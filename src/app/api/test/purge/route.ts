// Purge des données créées par les tests e2e. N'existe qu'hors production,
// quand la connexion de test est active, et exige une session.
import { devLoginEnabled } from "@/auth";
import { getDb } from "@/db";
import { DomainError, purgeTestData } from "@/lib/repo";
import { getCurrentUser } from "@/lib/session";
import { remove } from "@/lib/storage";

export async function POST(request: Request) {
  if (!devLoginEnabled) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { marker?: unknown; dryRun?: unknown };
  if (typeof body.marker !== "string") return Response.json({ error: "marker requis" }, { status: 400 });
  try {
    const result = await purgeTestData(getDb(), body.marker, { dryRun: body.dryRun === true });
    await remove(result.files);
    return Response.json({ objects: result.objects, todos: result.todos, types: result.types, files: result.files.length, names: result.names });
  } catch (err) {
    if (err instanceof DomainError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
