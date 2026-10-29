// Accès des assistants IA au serveur MCP : jetons personnels et OAuth 2.1
// (enregistrement dynamique, code d'autorisation + PKCE S256, jetons d'accès
// courts et jetons de rafraîchissement à rotation). Seules les empreintes
// SHA-256 des jetons et des codes sont stockées.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { apiTokens, oauthClients, oauthCodes, users, type ApiToken, type OAuthClient, type User } from "@/db/schema";

export const SCOPE = "lecture";
export const WRITE_SCOPE = "ecriture";
export const SCOPES = [SCOPE, WRITE_SCOPE] as const;
/** Portée enregistrée : « lecture » ou « lecture ecriture » (l'écriture inclut la lecture). */
export const scopeFor = (write: boolean) => (write ? `${SCOPE} ${WRITE_SCOPE}` : SCOPE);
export const canWrite = (scope: string | null | undefined) => (scope ?? "").split(/\s+/).includes(WRITE_SCOPE);
export const requestsWrite = (raw: string) => raw.split(/\s+/).includes(WRITE_SCOPE);
export const ACCESS_TTL_S = 60 * 60; // 1 h
export const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30 jours
export const CODE_TTL_S = 10 * 60; // 10 min

export class OAuthError extends Error {
  constructor(
    public error: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

const PREFIX = { personnel: "carnet_pat_", acces: "carnet_at_", rafraichissement: "carnet_rt_" } as const;
type Kind = keyof typeof PREFIX;

function newToken(kind: Kind) {
  const token = PREFIX[kind] + random(32);
  return { token, hash: sha256(token), prefix: token.slice(0, PREFIX[kind].length + 4) };
}

// ---------- Jetons personnels ----------

export async function createPersonalToken(db: Db, userId: string, rawName: string, write = false) {
  const name = rawName.trim().slice(0, 80) || "Jeton personnel";
  const t = newToken("personnel");
  const [row] = await db
    .insert(apiTokens)
    .values({ kind: "personnel", tokenHash: t.hash, prefix: t.prefix, name, userId, scope: scopeFor(write) })
    .returning();
  return { token: t.token, row };
}

export type AccessEntry = {
  id: string;
  kind: "personnel" | "application";
  name: string;
  prefix: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  write: boolean;
};

/** Jetons personnels actifs et applications OAuth autorisées (une ligne par autorisation). */
export async function listAccess(db: Db, userId: string): Promise<AccessEntry[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  const out: AccessEntry[] = [];
  const grants = new Map<string, AccessEntry>();
  for (const r of rows) {
    if (r.kind === "personnel") {
      out.push({ id: r.id, kind: "personnel", name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, write: canWrite(r.scope) });
      continue;
    }
    if (!r.grantId || (r.expiresAt && r.expiresAt < now)) continue;
    const g = grants.get(r.grantId);
    const last = r.lastUsedAt;
    if (!g) {
      grants.set(r.grantId, { id: r.grantId, kind: "application", name: r.name, prefix: null, createdAt: r.createdAt, lastUsedAt: last, write: canWrite(r.scope) });
    } else if (last && (!g.lastUsedAt || last > g.lastUsedAt)) g.lastUsedAt = last;
  }
  // Date de première autorisation : le plus ancien jeton encore valide de l'autorisation
  return [...out, ...grants.values()];
}

/** Révoque un jeton personnel ou toute une autorisation d'application (par son identifiant). */
export async function revokeAccess(db: Db, userId: string, id: string): Promise<boolean> {
  const now = new Date();
  const res = await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
        or(and(eq(apiTokens.id, id), eq(apiTokens.kind, "personnel")), eq(apiTokens.grantId, id)),
      ),
    )
    .returning({ id: apiTokens.id });
  return res.length > 0;
}

// ---------- Vérification d'un jeton présenté au MCP ----------

/** client : nom du jeton personnel ou de l'application OAuth (pour le journal). */
export type BearerAccess = { user: User; write: boolean; client: string };

/** Utilisateur actif correspondant à un jeton d'accès ou personnel valide, sinon null. */
export async function verifyBearer(db: Db, token: string): Promise<User | null> {
  return (await verifyBearerAccess(db, token))?.user ?? null;
}

/** Comme verifyBearer, avec les droits du jeton (écriture ou non). */
export async function verifyBearerAccess(db: Db, token: string): Promise<BearerAccess | null> {
  if (!/^carnet_(pat|at)_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const now = new Date();
  const [row] = await db
    .select({ t: apiTokens, u: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, sha256(token)),
        isNull(apiTokens.revokedAt),
        or(eq(apiTokens.kind, "personnel"), eq(apiTokens.kind, "acces")),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    );
  if (!row || !row.u.active) return null;
  // Date de dernière utilisation, au plus une écriture toutes les 5 minutes
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() > 5 * 60_000) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.t.id));
  }
  return { user: row.u, write: canWrite(row.t.scope), client: row.t.name };
}

// ---------- Clients OAuth ----------

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

/** Adresse de retour acceptable : https, http en local (loopback), ou schéma d'application (ex. cursor://). */
export function isValidRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (FORBIDDEN_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

export async function registerClient(db: Db, input: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === "string")) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris doit contenir 1 à 10 adresses");
  }
  for (const u of uris as string[]) {
    if (u.length > 500 || !isValidRedirectUri(u)) throw new OAuthError("invalid_redirect_uri", `Adresse de retour refusée : ${u}`);
  }
  const name = (typeof input.client_name === "string" ? input.client_name.trim() : "").slice(0, 100) || "Application MCP";
  const [row] = await db
    .insert(oauthClients)
    .values({ id: `carnet_client_${random(16)}`, name, redirectUris: uris as string[] })
    .returning();
  return row;
}

export async function getClient(db: Db, id: string): Promise<OAuthClient | undefined> {
  if (!id || id.length > 100) return undefined;
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  return row;
}

// ---------- Code d'autorisation ----------

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string | null;
};

/** Vérifie une demande d'autorisation ; renvoie le client si elle est valide. */
export async function validateAuthorize(db: Db, req: AuthorizeRequest & { responseType: string }): Promise<OAuthClient> {
  const client = await getClient(db, req.clientId);
  if (!client) throw new OAuthError("invalid_client", "Application inconnue : elle doit d'abord s'enregistrer.");
  if (!client.redirectUris.includes(req.redirectUri)) throw new OAuthError("invalid_request", "Adresse de retour non enregistrée.");
  if (req.responseType !== "code") throw new OAuthError("unsupported_response_type", "Seul response_type=code est accepté.");
  if (req.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(req.codeChallenge)) {
    throw new OAuthError("invalid_request", "PKCE (code_challenge, méthode S256) est obligatoire.");
  }
  const scopes = req.scope.split(/\s+/).filter(Boolean);
  if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) {
    throw new OAuthError("invalid_scope", `Portées possibles : ${SCOPES.join(", ")}.`);
  }
  return client;
}

/** Code d'autorisation ; `write` = l'utilisateur a accepté l'écriture sur l'écran de consentement. */
export async function createAuthCode(db: Db, userId: string, req: AuthorizeRequest, write = false): Promise<string> {
  const code = random(32);
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: req.clientId,
    userId,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    scope: scopeFor(write),
    resource: req.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
  });
  // Ménage des codes expirés
  await db.delete(oauthCodes).where(sql`${oauthCodes.expiresAt} < now() - interval '1 day'`);
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

async function issueTokens(db: Db, userId: string, client: OAuthClient, grantId: string, scope: string): Promise<TokenResponse> {
  const access = newToken("acces");
  const refresh = newToken("rafraichissement");
  const now = Date.now();
  await db.insert(apiTokens).values([
    {
      kind: "acces",
      tokenHash: access.hash,
      prefix: access.prefix,
      name: client.name,
      userId,
      clientId: client.id,
      grantId,
      scope,
      expiresAt: new Date(now + ACCESS_TTL_S * 1000),
    },
    {
      kind: "rafraichissement",
      tokenHash: refresh.hash,
      prefix: refresh.prefix,
      name: client.name,
      userId,
      clientId: client.id,
      grantId,
      scope,
      expiresAt: new Date(now + REFRESH_TTL_S * 1000),
    },
  ]);
  return { access_token: access.token, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh.token, scope };
}

function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Échange d'un code d'autorisation contre des jetons (usage unique). */
export async function exchangeCode(
  db: Db,
  p: { code: string; clientId: string; redirectUri: string; codeVerifier: string },
): Promise<TokenResponse> {
  const client = await getClient(db, p.clientId);
  if (!client) throw new OAuthError("invalid_client", "Application inconnue", 401);
  // Marquage atomique : un code ne sert qu'une fois
  const [code] = await db
    .update(oauthCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthCodes.codeHash, sha256(p.code ?? "")), isNull(oauthCodes.usedAt)))
    .returning();
  if (!code) throw new OAuthError("invalid_grant", "Code invalide ou déjà utilisé");
  if (code.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Code expiré");
  if (code.clientId !== client.id) throw new OAuthError("invalid_grant", "Code émis pour une autre application");
  if (code.redirectUri !== p.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri différente de la demande");
  if (!pkceMatches(p.codeVerifier ?? "", code.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier incorrect");
  const [user] = await db.select().from(users).where(eq(users.id, code.userId));
  if (!user?.active) throw new OAuthError("invalid_grant", "Utilisateur désactivé");
  return issueTokens(db, user.id, client, crypto.randomUUID(), code.scope);
}

/** Rafraîchissement avec rotation ; la réutilisation d'un ancien jeton révoque toute l'autorisation. */
export async function refreshTokens(db: Db, p: { refreshToken: string; clientId: string }): Promise<TokenResponse> {
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(p.refreshToken ?? "")), eq(apiTokens.kind, "rafraichissement")));
  if (!row) throw new OAuthError("invalid_grant", "Jeton de rafraîchissement inconnu");
  if (row.clientId !== p.clientId) throw new OAuthError("invalid_grant", "Jeton émis pour une autre application");
  if (row.revokedAt) {
    if (row.grantId) {
      await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.grantId, row.grantId), isNull(apiTokens.revokedAt)));
    }
    throw new OAuthError("invalid_grant", "Jeton de rafraîchissement déjà utilisé : autorisation révoquée");
  }
  if (row.expiresAt && row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Jeton de rafraîchissement expiré");
  const client = await getClient(db, p.clientId);
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!client || !user?.active || !row.grantId) throw new OAuthError("invalid_grant", "Autorisation invalide");
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, row.id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!revoked) throw new OAuthError("invalid_grant", "Jeton de rafraîchissement déjà utilisé");
  return issueTokens(db, user.id, client, row.grantId, row.scope);
}

/** Révocation RFC 7009 : silencieuse si le jeton est inconnu. */
export async function revokeByToken(db: Db, token: string): Promise<void> {
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token ?? "")));
  if (!row) return;
  const cond = row.grantId ? eq(apiTokens.grantId, row.grantId) : eq(apiTokens.id, row.id);
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(cond, isNull(apiTokens.revokedAt)));
}

export type { ApiToken };
