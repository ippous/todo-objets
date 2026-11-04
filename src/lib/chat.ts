import "server-only";
// Chat de Carnet : un assistant IA (Claude ou ChatGPT, clés de Accès › Assistants IA) qui utilise
// les outils du serveur MCP de Carnet, branché en mémoire avec les droits de l'utilisateur connecté.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Db } from "@/db";
import type { User } from "@/db/schema";
import { AI_PROVIDER_LABEL, AiError, type AiProvider } from "./ai";
import { buildMcpServer } from "./mcp-server";

export const CHAT_CLIENT = "Chat Carnet";
export const CHAT_MAX_STEPS = 12;
const TOOL_TEXT_MAX = 40_000;
const HISTORY_MAX = 30;

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** Évènements envoyés au navigateur au fil de la réponse. */
export type ChatEvent =
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; steps: number };

type Target = { provider: AiProvider; model: string; apiKey: string };
type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
type ToolOutput = { text: string; images: { mediaType: string; data: string }[]; isError: boolean };

function baseUrl(p: AiProvider) {
  const env = p === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL;
  return (env || (p === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com")).replace(/\/+$/, "").replace(/\/v1$/, "");
}

function systemPrompt(user: User, instructions: string, allowDelete: boolean) {
  const today = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full" }).format(new Date());
  return [
    `Tu es l'assistant intégré à Carnet, l'appli de ${user.name}. Nous sommes le ${today} (fuseau Europe/Paris).`,
    instructions,
    "Réponds en français, brièvement et concrètement. Utilise les outils plutôt que de supposer : cherche avant de répondre, " +
      "et vérifie l'objet ou la tâche avant de modifier. Quand tu cites une tâche ou un objet, donne un lien Markdown vers sa page " +
      "avec l'adresse `url` renvoyée par l'outil, par exemple [Réparer la clôture](https://…/taches/…).",
    "Avant une modification importante ou en lot (plusieurs tâches, déplacement d'objet), résume ce que tu vas faire et demande confirmation, " +
      "sauf si l'utilisateur l'a déjà clairement demandé.",
    allowDelete
      ? "Les suppressions sont autorisées dans cette conversation, mais demande toujours une confirmation explicite avant de supprimer."
      : "Les suppressions ne sont pas autorisées ici : si on t'en demande une, explique qu'il faut cocher « Autoriser les suppressions » ou la faire dans l'appli.",
  ].join("\n\n");
}

/** Résumé court d'un résultat d'outil, pour l'affichage. */
function summarize(name: string, out: ToolOutput): string {
  if (out.isError) return out.text.slice(0, 200);
  try {
    const d = JSON.parse(out.text) as Record<string, unknown>;
    if (Array.isArray(d.taches)) return `${d.taches.length} tâche${d.taches.length > 1 ? "s" : ""}${d.total && d.total !== d.taches.length ? ` sur ${d.total}` : ""}`;
    if (Array.isArray(d.objets)) return `${d.objets.length} objet${d.objets.length > 1 ? "s" : ""}`;
    if (typeof d.titre === "string") return String(d.titre);
    if (typeof d.nom === "string") return String(d.nom);
    if (d.modifie || d.cree || d.ajoute) return "fait";
  } catch {
    /* texte libre */
  }
  if (out.images.length) return `${out.images.length} image${out.images.length > 1 ? "s" : ""}`;
  return name === "vue_ensemble" ? "résumé de Carnet" : out.text.slice(0, 120);
}

async function callProvider(target: Target, body: unknown, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const url = target.provider === "anthropic" ? `${baseUrl("anthropic")}/v1/messages` : `${baseUrl("openai")}/v1/chat/completions`;
  const headers: Record<string, string> =
    target.provider === "anthropic"
      ? { "content-type": "application/json", "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" }
      : { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` };
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiError(timeout ? "L'assistant IA n'a pas répondu à temps, réessaie" : "Impossible de joindre l'assistant IA");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !json) {
    const label = AI_PROVIDER_LABEL[target.provider];
    if (res.status === 401 || res.status === 403) throw new AiError(`${label} refuse la clé d'API`);
    if (res.status === 429) throw new AiError(`${label} : trop de demandes ou crédit épuisé`);
    if (res.status === 404) throw new AiError(`Modèle « ${target.model} » inconnu chez ${label}`);
    const msg = (json?.error as { message?: string } | undefined)?.message;
    throw new AiError(`${label} : ${msg ?? `erreur ${res.status}`}`);
  }
  return json;
}

/**
 * Fait répondre l'assistant : appels au modèle et aux outils de Carnet jusqu'à une réponse finale
 * (CHAT_MAX_STEPS tours au plus). `emit` reçoit chaque appel d'outil et le texte.
 */
export async function runChat(
  db: Db,
  opts: {
    user: User;
    origin: string;
    target: Target;
    history: ChatTurn[];
    allowDelete?: boolean;
    emit: (e: ChatEvent) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  const { user, target, emit } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const server = buildMcpServer(db, user, opts.origin, true, CHAT_CLIENT, !!opts.allowDelete);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: CHAT_CLIENT, version: "1.0.0" });
  await client.connect(b);

  try {
    const tools: Tool[] = (await client.listTools()).tools.map((t) => ({
      name: t.name,
      description: t.description ?? t.title ?? t.name,
      // « $schema » n'est pas attendu par les API des modèles
      inputSchema: Object.fromEntries(Object.entries(t.inputSchema as Record<string, unknown>).filter(([k]) => k !== "$schema")),
    }));
    const system = systemPrompt(user, client.getInstructions() ?? "", !!opts.allowDelete);
    const history = opts.history.filter((m) => m.text.trim()).slice(-HISTORY_MAX);
    if (!history.length || history.at(-1)!.role !== "user") throw new AiError("Pose une question");

    const runTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutput> => {
      try {
        const r = await client.callTool({ name, arguments: args });
        const content = (r.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[];
        return {
          text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").slice(0, TOOL_TEXT_MAX) || "(vide)",
          images: content.filter((c) => c.type === "image" && c.data).map((c) => ({ mediaType: c.mimeType ?? "image/jpeg", data: c.data! })),
          isError: !!r.isError,
        };
      } catch (err) {
        return { text: `Erreur : ${err instanceof Error ? err.message : String(err)}`, images: [], isError: true };
      }
    };

    let steps = 0;
    if (target.provider === "anthropic") {
      const messages: Record<string, unknown>[] = history.map((m) => ({ role: m.role, content: m.text }));
      const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      for (;;) {
        steps++;
        const r = await callProvider(target, { model: target.model, max_tokens: 4000, system, tools: toolDefs, messages }, fetchImpl);
        const content = (r.content as { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]) ?? [];
        const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        if (text.trim()) emit({ type: "text", text });
        const uses = content.filter((c) => c.type === "tool_use");
        if (!uses.length || r.stop_reason !== "tool_use") break;
        if (steps >= CHAT_MAX_STEPS) {
          emit({ type: "text", text: "\n\n(Arrêt : trop d'étapes pour une seule demande. Reformule ou découpe la demande.)" });
          break;
        }
        messages.push({ role: "assistant", content });
        const results: Record<string, unknown>[] = [];
        for (const u of uses) {
          emit({ type: "tool", id: u.id!, name: u.name!, args: u.input ?? {} });
          const out = await runTool(u.name!, u.input ?? {});
          emit({ type: "tool_result", id: u.id!, name: u.name!, ok: !out.isError, summary: summarize(u.name!, out) });
          results.push({
            type: "tool_result",
            tool_use_id: u.id,
            is_error: out.isError,
            content: [
              { type: "text", text: out.text },
              ...out.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
            ],
          });
        }
        messages.push({ role: "user", content: results });
      }
    } else {
      const messages: Record<string, unknown>[] = [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))];
      const toolDefs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      for (;;) {
        steps++;
        const r = await callProvider(target, { model: target.model, max_completion_tokens: 4000, tools: toolDefs, messages }, fetchImpl);
        const msg = ((r.choices as { message?: Record<string, unknown> }[] | undefined)?.[0]?.message ?? {}) as {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        if (msg.content?.trim()) emit({ type: "text", text: msg.content });
        const calls = msg.tool_calls ?? [];
        if (!calls.length) break;
        if (steps >= CHAT_MAX_STEPS) {
          emit({ type: "text", text: "\n\n(Arrêt : trop d'étapes pour une seule demande. Reformule ou découpe la demande.)" });
          break;
        }
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
        const images: { mediaType: string; data: string }[] = [];
        for (const c of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.function.arguments || "{}");
          } catch {
            /* arguments illisibles : l'outil le signalera */
          }
          emit({ type: "tool", id: c.id, name: c.function.name, args });
          const out = await runTool(c.function.name, args);
          emit({ type: "tool_result", id: c.id, name: c.function.name, ok: !out.isError, summary: summarize(c.function.name, out) });
          images.push(...out.images);
          messages.push({ role: "tool", tool_call_id: c.id, content: out.text + (out.images.length ? `\n(${out.images.length} image(s) jointe(s) ci-après)` : "") });
        }
        // Les messages « tool » n'acceptent que du texte : les images suivent dans un message utilisateur
        if (images.length) {
          messages.push({
            role: "user",
            content: images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
          });
        }
      }
    }
    emit({ type: "done", steps });
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
