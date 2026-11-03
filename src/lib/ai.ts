import "server-only";
// Assistants IA : réglages (fournisseurs, modèles, clés d'API chiffrées en base)
// et appel unifié aux API de Claude (Anthropic) et de ChatGPT (OpenAI).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = { anthropic: "Claude (Anthropic)", openai: "ChatGPT (OpenAI)" };
export const AI_DEFAULT_MODEL: Record<AiProvider, string> = { anthropic: "claude-sonnet-5-5", openai: "gpt-5.5" };
/** Suggestions affichées dans le champ « modèle » (on peut en saisir un autre). */
export const AI_MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  openai: ["gpt-5.5", "gpt-5-mini"],
};

type StoredProvider = { model: string; key?: string /* chiffrée */; keyHint?: string };
type Stored = { defaultProvider?: AiProvider; providers?: Partial<Record<AiProvider, StoredProvider>> };

/** Vue sans secret, pour l'interface. */
export type AiSettingsView = {
  defaultProvider: AiProvider | null;
  providers: Record<AiProvider, { model: string; configured: boolean; keyHint: string | null }>;
};

const KEY = "ia";

// ---------- Chiffrement des clés (AES-256-GCM, clé dérivée de AUTH_SECRET) ----------

function cryptoKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET n'est pas défini : impossible de chiffrer les clés d'API");
  return Buffer.from(hkdfSync("sha256", secret, "carnet", "cles-api-ia", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cryptoKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new AiError("Clé d'API illisible : enregistre-la à nouveau");
  try {
    const d = createDecipheriv("aes-256-gcm", cryptoKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    // Typiquement : AUTH_SECRET a changé depuis l'enregistrement de la clé
    throw new AiError("Clé d'API illisible (le secret du serveur a changé ?) : enregistre-la à nouveau");
  }
}

// ---------- Réglages ----------

async function readStored(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value as Stored | undefined) ?? {};
}

export async function getAiSettings(db: Db): Promise<AiSettingsView> {
  const s = await readStored(db);
  const providers = Object.fromEntries(
    AI_PROVIDERS.map((p) => {
      const sp = s.providers?.[p];
      return [p, { model: sp?.model || AI_DEFAULT_MODEL[p], configured: Boolean(sp?.key), keyHint: sp?.keyHint ?? null }];
    }),
  ) as AiSettingsView["providers"];
  const configured = AI_PROVIDERS.filter((p) => providers[p].configured);
  const defaultProvider = s.defaultProvider && providers[s.defaultProvider].configured ? s.defaultProvider : (configured[0] ?? null);
  return { defaultProvider, providers };
}

export class AiError extends Error {}

/**
 * Met à jour un fournisseur. `apiKey` : undefined = ne pas toucher, "" = effacer, sinon nouvelle clé.
 */
export async function saveAiProvider(
  db: Db,
  provider: AiProvider,
  data: { model: string; apiKey?: string; makeDefault?: boolean },
): Promise<void> {
  const model = data.model.trim() || AI_DEFAULT_MODEL[provider];
  if (model.length > 100 || !/^[\w.:/-]+$/.test(model)) throw new AiError("Nom de modèle invalide");
  const s = await readStored(db);
  const prev = s.providers?.[provider];
  const next: StoredProvider = { model, key: prev?.key, keyHint: prev?.keyHint };
  if (data.apiKey !== undefined) {
    const k = data.apiKey.trim();
    if (!k) {
      delete next.key;
      delete next.keyHint;
    } else {
      if (k.length < 20 || k.length > 400 || /\s/.test(k)) throw new AiError("Clé d'API invalide");
      next.key = encryptSecret(k);
      next.keyHint = `…${k.slice(-4)}`;
    }
  }
  const value: Stored = { ...s, providers: { ...s.providers, [provider]: next } };
  if (data.makeDefault) value.defaultProvider = provider;
  await db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function setDefaultAiProvider(db: Db, provider: AiProvider): Promise<void> {
  const s = await readStored(db);
  if (!s.providers?.[provider]?.key) throw new AiError("Ce fournisseur n'a pas de clé d'API");
  const value: Stored = { ...s, defaultProvider: provider };
  await db
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

// ---------- Appel ----------

export type AiRequest = { system: string; prompt: string; maxTokens?: number };

/** Fournisseur à utiliser : celui demandé s'il est configuré, sinon celui par défaut. */
export async function resolveProvider(db: Db, wanted?: string | null): Promise<{ provider: AiProvider; model: string; apiKey: string }> {
  const s = await readStored(db);
  const view = await getAiSettings(db);
  const provider = (AI_PROVIDERS as readonly string[]).includes(wanted ?? "") ? (wanted as AiProvider) : view.defaultProvider;
  if (!provider) throw new AiError("Aucun assistant IA n'est configuré. Un administrateur peut ajouter une clé d'API dans Accès › Assistants IA.");
  const sp = s.providers?.[provider];
  if (!sp?.key) throw new AiError(`${AI_PROVIDER_LABEL[provider]} n'est pas configuré`);
  return { provider, model: sp.model || AI_DEFAULT_MODEL[provider], apiKey: decryptSecret(sp.key) };
}

/** Adresse de l'API ; ANTHROPIC_BASE_URL / OPENAI_BASE_URL permettent un relais ou un faux serveur de test. */
function baseUrl(p: AiProvider) {
  const env = p === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.OPENAI_BASE_URL;
  return (env || (p === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com")).replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Envoie la demande au fournisseur et renvoie le texte de la réponse. */
export async function aiComplete(
  target: { provider: AiProvider; model: string; apiKey: string },
  req: AiRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const maxTokens = req.maxTokens ?? 4000;
  const signal = AbortSignal.timeout(90_000);
  let res: Response;
  try {
    res =
      target.provider === "anthropic"
        ? await fetchImpl(`${baseUrl("anthropic")}/v1/messages`, {
            method: "POST",
            signal,
            headers: { "content-type": "application/json", "x-api-key": target.apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: target.model,
              max_tokens: maxTokens,
              system: req.system,
              messages: [{ role: "user", content: req.prompt }],
            }),
          })
        : await fetchImpl(`${baseUrl("openai")}/v1/chat/completions`, {
            method: "POST",
            signal,
            headers: { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` },
            body: JSON.stringify({
              model: target.model,
              max_completion_tokens: maxTokens,
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.prompt },
              ],
            }),
          });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AiError(timeout ? "L'assistant IA n'a pas répondu à temps, réessaie" : "Impossible de joindre l'assistant IA");
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (body?.error as { message?: string } | undefined)?.message;
    if (res.status === 401 || res.status === 403) throw new AiError(`${AI_PROVIDER_LABEL[target.provider]} refuse la clé d'API`);
    if (res.status === 429) throw new AiError(`${AI_PROVIDER_LABEL[target.provider]} : trop de demandes ou crédit épuisé`);
    if (res.status === 404) throw new AiError(`Modèle « ${target.model} » inconnu chez ${AI_PROVIDER_LABEL[target.provider]}`);
    throw new AiError(`${AI_PROVIDER_LABEL[target.provider]} : ${msg ?? `erreur ${res.status}`}`);
  }

  const text =
    target.provider === "anthropic"
      ? ((body?.content as { type: string; text?: string }[] | undefined) ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : ((body?.choices as { message?: { content?: string | null } }[] | undefined)?.[0]?.message?.content ?? "");
  if (!text.trim()) throw new AiError("L'assistant IA a renvoyé une réponse vide");
  return text;
}

/** Extrait le premier objet JSON d'une réponse (les modèles l'entourent parfois de ```json). */
export function parseJsonReply<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("Réponse de l'assistant IA inattendue, réessaie");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new AiError("Réponse de l'assistant IA inattendue, réessaie");
  }
}

/** Fournisseurs configurés, pour les boutons IA de l'interface (sans secret). */
export async function getAiChoice(db: Db): Promise<{ providers: { id: string; label: string }[]; defaultProvider: string | null }> {
  const s = await getAiSettings(db);
  return {
    providers: AI_PROVIDERS.filter((p) => s.providers[p].configured).map((p) => ({ id: p, label: AI_PROVIDER_LABEL[p] })),
    defaultProvider: s.defaultProvider,
  };
}
