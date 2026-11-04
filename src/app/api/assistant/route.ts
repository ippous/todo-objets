// Chat de Carnet : réponse de l'assistant IA en flux NDJSON (un évènement par ligne), avec ses appels d'outils.
import { getDb } from "@/db";
import { AiError, resolveProvider } from "@/lib/ai";
import { runChat, type ChatEvent, type ChatTurn } from "@/lib/chat";
import { originOf } from "@/lib/oauth-http";
import { getCurrentUser } from "@/lib/session";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { provider?: string; history?: unknown; allowDelete?: unknown } | null;
  const history: ChatTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter((m): m is ChatTurn => !!m && typeof m === "object" && ((m as ChatTurn).role === "user" || (m as ChatTurn).role === "assistant") && typeof (m as ChatTurn).text === "string")
        .map((m) => ({ role: m.role, text: m.text.slice(0, 20_000) }))
    : [];
  const db = getDb();
  let target;
  try {
    target = await resolveProvider(db, body?.provider ?? null);
  } catch (err) {
    return Response.json({ error: err instanceof AiError ? err.message : "Assistant IA indisponible" }, { status: 400 });
  }
  const origin = originOf(request);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runChat(db, { user, origin, target, history, allowDelete: body?.allowDelete === true, emit });
      } catch (err) {
        if (!(err instanceof AiError)) console.error("assistant", err);
        emit({ type: "error", message: err instanceof AiError ? err.message : "Une erreur est survenue. Réessaie dans un instant." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
