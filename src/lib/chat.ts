import "server-only";
// Chat de Carnet : un assistant IA (Claude ou ChatGPT, clés de Accès › Assistants IA) qui utilise
// les outils du serveur MCP de Carnet, branché en mémoire avec les droits de l'utilisateur connecté.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Db } from "@/db";
import type { User } from "@/db/schema";
import { AI_PROVIDER_LABEL, AiError, type AiProvider } from "./ai";
import { buildMcpServer } from "./mcp-server";
import { getPieces, pieceContent, readPiece, type PieceContent } from "./chat-pieces";
import type { ChatAttachment } from "@/db/schema";

export const CHAT_CLIENT = "Chat Carnet";
export const CHAT_MAX_STEPS = 12;
const TOOL_TEXT_MAX = 40_000;
const HISTORY_MAX = 30;

/** Un message ; `pieces` : identifiants des pièces jointes (messages de l'utilisateur). */
export type ChatTurn = { role: "user" | "assistant"; text: string; pieces?: string[] };

/** Évènements envoyés au navigateur au fil de la réponse. */
export type ChatEvent =
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "text"; text: string }
  /** Page de Carnet à afficher (outil ouvrir_page), chemin relatif */
  | { type: "navigate"; path: string }
  | { type: "error"; message: string }
  | { type: "done"; steps: number };

type Target = { provider: AiProvider; model: string; apiKey: string };
type Tool = { name: string; description: string; inputSchema: Record<string, unknown> };
type ToolOutput = {
  text: string;
  images: { mediaType: string; data: string }[];
  /** PDF renvoyés par lire_document, transmis au modèle comme documents */
  pdfs: { name: string; data: string }[];
  isError: boolean;
};

/** Contenu des pièces des derniers messages : au-delà, seul leur nom est rappelé (coût). */
const PIECES_READ_MESSAGES = 2;

const JOIN_TOOL: Tool = {
  name: "joindre_piece",
  description:
    "Ajoute une pièce jointe de cette conversation (identifiant piece_id donné avec le message de l'utilisateur) à une tâche OU à un objet : " +
    "une image devient une photo (comme ajouter_photo), sauf comme=document ; un autre fichier devient un document (comme ajouter_document).",
  inputSchema: {
    type: "object",
    properties: {
      piece_id: { type: "string", description: "Identifiant de la pièce jointe" },
      tache_id: { type: "string", description: "Tâche à laquelle l'ajouter" },
      objet_id: { type: "string", description: "Objet auquel l'ajouter" },
      comme: { type: "string", enum: ["photo", "document"], description: "Pour une image : photo (par défaut) ou document" },
      description: { type: "string", description: "Légende ou description, facultative" },
      type_document: { type: "string", description: "Type de document (Facture, Garantie…), pour un document ; « Autre » par défaut" },
    },
    required: ["piece_id"],
  },
};

const OPEN_TOOL: Tool = {
  name: "ouvrir_page",
  description:
    "Affiche une page de Carnet à l'utilisateur, à la fin de ta réponse (une seule page par réponse ; la dernière demandée l'emporte). " +
    "Utilise-le quand on te demande d'ouvrir, d'afficher, de montrer ou d'aller sur une page. Pages : " +
    "/taches/<id> (fiche de tâche, `url` renvoyée par les outils), /objets/<id> (fiche d'objet), / (arbre des objets), " +
    "/taches (liste ; paramètres vue=tableau|gantt, objet=<id> pour le sous-arbre, q=texte, statut=a_faire|en_cours|fait|toutes, " +
    "priorite, responsable=<id>|none, tag, avant=AAAA-MM-JJ, tri=priorite|ratio|recent), " +
    "/taches/nouvelle?objet=<id> (nouvelle tâche), /objets/nouveau?parent=<id> (nouvel objet), /journal, /rappels, /types, /commandes.",
  inputSchema: {
    type: "object",
    properties: {
      page: { type: "string", description: "Chemin (/taches?vue=gantt&objet=…) ou adresse complète de Carnet" },
    },
    required: ["page"],
  },
};

/** Chemin interne sûr à partir d'une adresse donnée par le modèle (même site, pas d'API). */
export function pagePath(page: unknown, origin: string): string | null {
  if (typeof page !== "string") return null;
  let p = page.trim();
  if (p.startsWith(origin)) p = p.slice(origin.length) || "/";
  else if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      if (u.host !== new URL(origin).host) return null;
      p = u.pathname + u.search;
    } catch {
      return null;
    }
  }
  if (!/^\/(?!\/)[\w\-/]*(\?[\w\-=&%.,+:]*)?(#[\w-]*)?$/.test(p)) return null;
  if (/^\/api(\/|\?|$)/.test(p) || /^\/(connexion|deconnexion)\b/.test(p)) return null;
  return p;
}

function baseUrl(p: AiProvider) {
  const env = p === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL;
  return (env || (p === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com")).replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Page affichée, en clair pour le modèle (« cette tâche », « cet objet »). */
export function describePage(page: string | null | undefined, origin: string): string | null {
  if (!page || !/^\/[\w\-/]*$/.test(page)) return null;
  const id = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const t = new RegExp(`^/taches/${id}$`, "i").exec(page);
  if (t) return `L'utilisateur regarde la fiche de la tâche ${t[1]} (${origin}/taches/${t[1]}) : « cette tâche » désigne celle-ci (lis-la avec obtenir_tache).`;
  const o = new RegExp(`^/objets/${id}(?:/modifier)?$`, "i").exec(page);
  if (o) return `L'utilisateur regarde la fiche de l'objet ${o[1]} (${origin}/objets/${o[1]}) : « cet objet » ou « ici » désigne celui-ci (lis-le avec obtenir_objet).`;
  const names: Record<string, string> = {
    "/": "l'arbre des objets",
    "/taches": "la liste des tâches",
    "/taches/nouvelle": "le formulaire de nouvelle tâche",
    "/journal": "le journal des actions",
    "/rappels": "ses réglages de rappels",
    "/types": "la gestion des types",
  };
  return `L'utilisateur est sur la page ${names[page] ?? page}.`;
}

function systemPrompt(user: User, instructions: string, allowDelete: boolean, page: string | null) {
  const today = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full" }).format(new Date());
  return [
    `Tu es l'assistant intégré à Carnet, l'appli de ${user.name}. Nous sommes le ${today} (fuseau Europe/Paris).`,
    instructions,
    "Réponds en français, brièvement et concrètement. Utilise les outils plutôt que de supposer : cherche avant de répondre, " +
      "et vérifie l'objet ou la tâche avant de modifier. Quand tu cites une tâche ou un objet, donne un lien Markdown vers sa page " +
      "avec l'adresse `url` renvoyée par l'outil, par exemple [Réparer la clôture](https://…/taches/…).",
    "L'utilisateur peut joindre des images et des documents à ses messages : tu les vois (images, PDF, texte extrait). " +
      "Pour en ajouter un à une tâche ou à un objet, utilise joindre_piece avec son piece_id (jamais ajouter_photo ou ajouter_document avec un contenu recopié).",
    "Pour afficher une page de Carnet (« ouvre la tâche… », « montre le Gantt de la grange »), trouve-la avec les outils puis appelle ouvrir_page ; " +
      "la page s'ouvre à la fin de ta réponse, que tu gardes alors très courte.",
    "Avant une modification importante ou en lot (plusieurs tâches, déplacement d'objet), résume ce que tu vas faire et demande confirmation, " +
      "sauf si l'utilisateur l'a déjà clairement demandé.",
    ...(page ? [page] : []),
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
  if (name === "ouvrir_page") return out.text.replace(/^La page (\S+).*$/, "$1");
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
    /** Chemin de la page affichée (ex. /taches/…), pour comprendre « cette tâche ». */
    page?: string | null;
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
    const system = systemPrompt(user, client.getInstructions() ?? "", !!opts.allowDelete, describePage(opts.page, opts.origin));
    tools.push(JOIN_TOOL, OPEN_TOOL);
    const history = opts.history.filter((m) => m.text.trim() || m.pieces?.length).slice(-HISTORY_MAX);
    if (!history.length || history.at(-1)!.role !== "user") throw new AiError("Pose une question");

    // Pièces jointes : celles de cet utilisateur seulement ; contenu lu pour les derniers messages
    const pieceRows = await getPieces(db, user.id, history.flatMap((m) => m.pieces ?? []));
    const pieceById = new Map(pieceRows.map((p) => [p.id, p]));
    const withPieces = history.map((m, i) => (m.role === "user" && m.pieces?.some((id) => pieceById.has(id)) ? i : -1)).filter((i) => i >= 0);
    const readable = new Set(withPieces.slice(-PIECES_READ_MESSAGES));
    const contents = new Map<string, PieceContent>();
    for (const i of readable) for (const id of history[i].pieces ?? []) if (pieceById.has(id)) contents.set(id, await pieceContent(pieceById.get(id)!));
    const label = (p: ChatAttachment) => `Pièce jointe « ${p.filename} » (piece_id ${p.id}, ${p.contentType}, ${Math.round(p.size / 1024)} Ko)`;
    const piecesOf = (m: ChatTurn) => (m.pieces ?? []).map((id) => pieceById.get(id)).filter((p): p is ChatAttachment => !!p);
    const textOf = (m: ChatTurn) => m.text.trim() || "(voir les pièces jointes)";

    /** Message utilisateur pour Claude : texte, puis chaque pièce (image, PDF, texte extrait ou simple nom). */
    const anthropicContent = (m: ChatTurn) => {
      const ps = piecesOf(m);
      if (!ps.length) return m.text;
      const parts: Record<string, unknown>[] = [{ type: "text", text: textOf(m) }];
      for (const p of ps) {
        const c = contents.get(p.id);
        parts.push({ type: "text", text: label(p) + (c ? "" : " — contenu déjà vu plus haut, non renvoyé") });
        if (c?.kind === "image") parts.push({ type: "image", source: { type: "base64", media_type: c.mediaType, data: c.data } });
        else if (c?.kind === "pdf") parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: c.data }, title: p.filename });
        else if (c?.kind === "text") parts.push({ type: "text", text: `Contenu de « ${p.filename} » :\n${c.text}` });
        else if (c) parts.push({ type: "text", text: "(contenu non lisible par l'assistant)" });
      }
      return parts;
    };
    /** Même chose pour ChatGPT (image_url, file). */
    const openaiContent = (m: ChatTurn) => {
      const ps = piecesOf(m);
      if (!ps.length) return m.text;
      const parts: Record<string, unknown>[] = [{ type: "text", text: textOf(m) }];
      for (const p of ps) {
        const c = contents.get(p.id);
        parts.push({ type: "text", text: label(p) + (c ? "" : " — contenu déjà vu plus haut, non renvoyé") });
        if (c?.kind === "image") parts.push({ type: "image_url", image_url: { url: `data:${c.mediaType};base64,${c.data}` } });
        else if (c?.kind === "pdf") parts.push({ type: "file", file: { filename: p.filename, file_data: `data:application/pdf;base64,${c.data}` } });
        else if (c?.kind === "text") parts.push({ type: "text", text: `Contenu de « ${p.filename} » :\n${c.text}` });
        else if (c) parts.push({ type: "text", text: "(contenu non lisible par l'assistant)" });
      }
      return parts;
    };

    /** joindre_piece : la pièce passe par ajouter_photo / ajouter_document, en mémoire. */
    const joinPiece = async (args: Record<string, unknown>) => {
      const p = typeof args.piece_id === "string" ? (pieceById.get(args.piece_id) ?? (await getPieces(db, user.id, [args.piece_id]))[0]) : undefined;
      if (!p) return { content: [{ type: "text", text: "Pièce jointe introuvable (piece_id)" }], isError: true };
      const bytes = await readPiece(p);
      if (!bytes) return { content: [{ type: "text", text: "Fichier de la pièce jointe introuvable" }], isError: true };
      const owner = typeof args.tache_id === "string" ? { kind: "tache", id: args.tache_id } : typeof args.objet_id === "string" ? { kind: "objet", id: args.objet_id } : null;
      if (!owner) return { content: [{ type: "text", text: "Indique tache_id ou objet_id" }], isError: true };
      const description = typeof args.description === "string" && args.description.trim() ? args.description : undefined;
      const asPhoto = p.contentType.startsWith("image/") && args.comme !== "document";
      return asPhoto
        ? client.callTool({
            name: "ajouter_photo",
            arguments: { image_base64: bytes.toString("base64"), [`${owner.kind}_ids`]: [owner.id], description },
          })
        : client.callTool({
            name: "ajouter_document",
            arguments: {
              [`${owner.kind}_id`]: owner.id,
              nom_fichier: p.filename,
              fichier_base64: bytes.toString("base64"),
              format: p.contentType,
              type_document: typeof args.type_document === "string" ? args.type_document : undefined,
              description,
            },
          });
    };

    const runTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutput> => {
      if (name === OPEN_TOOL.name) {
        const path = pagePath(args.page, opts.origin);
        if (!path) return { text: "Adresse refusée : donne un chemin de Carnet (ex. /taches/<id>)", images: [], pdfs: [], isError: true };
        emit({ type: "navigate", path });
        return { text: `La page ${path} s'affichera à la fin de ta réponse.`, images: [], pdfs: [], isError: false };
      }
      try {
        const r = name === JOIN_TOOL.name ? await joinPiece(args) : await client.callTool({ name, arguments: args });
        const content = (r.content ?? []) as {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
          resource?: { uri?: string; mimeType?: string; blob?: string };
        }[];
        return {
          text: content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").slice(0, TOOL_TEXT_MAX) || "(vide)",
          images: content.filter((c) => c.type === "image" && c.data).map((c) => ({ mediaType: c.mimeType ?? "image/jpeg", data: c.data! })),
          pdfs: content
            .filter((c) => c.type === "resource" && c.resource?.mimeType === "application/pdf" && c.resource.blob)
            .map((c) => ({ name: c.resource!.uri?.split("/").pop() ?? "document.pdf", data: c.resource!.blob! })),
          isError: !!r.isError,
        };
      } catch (err) {
        return { text: `Erreur : ${err instanceof Error ? err.message : String(err)}`, images: [], pdfs: [], isError: true };
      }
    };

    let steps = 0;
    if (target.provider === "anthropic") {
      const messages: Record<string, unknown>[] = history.map((m) => ({ role: m.role, content: m.role === "user" ? anthropicContent(m) : m.text }));
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
              ...out.pdfs.map((d) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } })),
            ],
          });
        }
        messages.push({ role: "user", content: results });
      }
    } else {
      const messages: Record<string, unknown>[] = [
        { role: "system", content: system },
        ...history.map((m) => ({ role: m.role, content: m.role === "user" ? openaiContent(m) : m.text })),
      ];
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
        const pdfs: { name: string; data: string }[] = [];
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
          pdfs.push(...out.pdfs);
          const extra = out.images.length + out.pdfs.length;
          messages.push({ role: "tool", tool_call_id: c.id, content: out.text + (extra ? `\n(${extra} fichier(s) joint(s) ci-après)` : "") });
        }
        // Les messages « tool » n'acceptent que du texte : les images suivent dans un message utilisateur
        if (images.length || pdfs.length) {
          messages.push({
            role: "user",
            content: [
              ...images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } })),
              ...pdfs.map((d) => ({ type: "file", file: { filename: d.name, file_data: `data:application/pdf;base64,${d.data}` } })),
            ],
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
