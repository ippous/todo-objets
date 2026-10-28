// Client minimal du serveur MCP de Carnet (transport Streamable HTTP sans session, réponse JSON).
// Chaque appel est un « tools/call » JSON-RPC autonome, authentifié par un jeton personnel.

export const DEFAULT_SERVER = "https://todo.jaume-eric.com";

export class CarnetError extends Error {
  /** @param {string} message @param {"config"|"auth"|"droits"|"reseau"|"outil"} kind */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

export async function loadSettings() {
  const s = await chrome.storage.local.get(["server", "token"]);
  return { server: normalizeServer(s.server || DEFAULT_SERVER), token: (s.token || "").trim() };
}

export async function saveSettings({ server, token }) {
  await chrome.storage.local.set({ server: normalizeServer(server || DEFAULT_SERVER), token: (token || "").trim() });
}

export function normalizeServer(s) {
  return String(s).trim().replace(/\/+$/, "").replace(/\/api\/mcp$/, "");
}

let nextId = 1;

/**
 * Appelle un outil MCP de Carnet et renvoie son résultat structuré.
 * @param {string} name @param {Record<string, unknown>} args
 * @param {{server: string, token: string}} [settings]
 */
export async function callTool(name, args = {}, settings) {
  const { server, token } = settings ?? (await loadSettings());
  if (!token) throw new CarnetError("Aucun jeton configuré.", "config");

  let res;
  try {
    res = await fetch(`${server}/api/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch {
    throw new CarnetError(`Impossible de joindre ${server}.`, "reseau");
  }

  if (res.status === 401) throw new CarnetError("Jeton invalide, expiré ou révoqué.", "auth");
  const body = await readBody(res);
  if (!res.ok && !body) throw new CarnetError(`Erreur du serveur (${res.status}).`, "reseau");

  if (body?.error) {
    // Outil absent : le jeton n'a pas le droit d'écriture
    if (/not found|introuvable|unknown tool/i.test(body.error.message || "") && WRITE_TOOLS.has(name))
      throw new CarnetError("Ce jeton est en lecture seule.", "droits");
    throw new CarnetError(body.error.message || "Erreur inconnue.", "outil");
  }
  const result = body?.result;
  if (!result) throw new CarnetError("Réponse inattendue du serveur.", "reseau");
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) {
    if (/not found|unknown tool/i.test(text) && WRITE_TOOLS.has(name)) throw new CarnetError("Ce jeton est en lecture seule.", "droits");
    throw new CarnetError(text || "Erreur de l'outil.", "outil");
  }
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return { texte: text };
  }
}

const WRITE_TOOLS = new Set(["ajouter_lien", "ajouter_photo", "creer_tache", "modifier_tache"]);

async function readBody(res) {
  const raw = await res.text();
  if (!raw) return null;
  // Réponse JSON directe, ou flux SSE si le serveur en renvoie un
  if (raw.trimStart().startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const data = raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .pop();
  try {
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}
