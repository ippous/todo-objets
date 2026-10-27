import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import {
  createAuthCode,
  createPersonalToken,
  exchangeCode,
  isValidRedirectUri,
  listAccess,
  OAuthError,
  refreshTokens,
  registerClient,
  revokeAccess,
  revokeByToken,
  validateAuthorize,
  verifyBearer,
} from "@/lib/oauth";
import { createTestDb } from "./helpers";
import { eq } from "drizzle-orm";

let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  const [u] = await db.insert(users).values({ email: "a@exemple.fr", name: "Alice", role: "admin" }).returning();
  userId = u.id;
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

async function authorize(redirect = "https://claude.ai/api/mcp/auth_callback") {
  const client = await registerClient(db, { client_name: "Claude", redirect_uris: [redirect] });
  const { verifier, challenge } = pkce();
  const req = {
    clientId: client.id,
    redirectUri: redirect,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    scope: "lecture",
    resource: null,
  };
  await validateAuthorize(db, { ...req, responseType: "code" });
  const code = await createAuthCode(db, userId, req);
  return { client, code, verifier, redirect };
}

describe("jetons personnels", () => {
  it("création, vérification, révocation", async () => {
    const { token, row } = await createPersonalToken(db, userId, "Claude Desktop");
    expect(token).toMatch(/^carnet_pat_/);
    expect(row.tokenHash).not.toContain(token); // seule l'empreinte est stockée
    expect((await verifyBearer(db, token))?.email).toBe("a@exemple.fr");
    expect(await verifyBearer(db, token + "x")).toBeNull();
    expect((await listAccess(db, userId)).map((a) => a.name)).toEqual(["Claude Desktop"]);
    expect(await revokeAccess(db, userId, row.id)).toBe(true);
    expect(await verifyBearer(db, token)).toBeNull();
  });

  it("refuse un utilisateur désactivé", async () => {
    const { token } = await createPersonalToken(db, userId, "x");
    await db.update(users).set({ active: false }).where(eq(users.id, userId));
    expect(await verifyBearer(db, token)).toBeNull();
  });
});

describe("OAuth 2.1", () => {
  it("adresses de retour acceptées ou refusées", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:6274/cb", "http://127.0.0.1:33418", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
      expect(isValidRedirectUri(ok), ok).toBe(true);
    }
    for (const bad of ["http://evil.fr/cb", "javascript:alert(1)", "data:text/html,x", "https://a.fr/cb#frag", "pas une url"]) {
      expect(isValidRedirectUri(bad), bad).toBe(false);
    }
  });

  it("code + PKCE → jetons ; le code ne sert qu'une fois", async () => {
    const { client, code, verifier, redirect } = await authorize();
    const t = await exchangeCode(db, { code, clientId: client.id, redirectUri: redirect, codeVerifier: verifier });
    expect(t.token_type).toBe("Bearer");
    expect((await verifyBearer(db, t.access_token))?.name).toBe("Alice");
    expect(await verifyBearer(db, t.refresh_token)).toBeNull(); // un jeton de rafraîchissement n'ouvre pas le MCP
    await expect(exchangeCode(db, { code, clientId: client.id, redirectUri: redirect, codeVerifier: verifier })).rejects.toMatchObject({
      error: "invalid_grant",
    });
    const access = await listAccess(db, userId);
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ kind: "application", name: "Claude" });
  });

  it("refuse un mauvais code_verifier, une autre redirect_uri ou un autre client", async () => {
    const a = await authorize();
    await expect(exchangeCode(db, { code: a.code, clientId: a.client.id, redirectUri: a.redirect, codeVerifier: pkce().verifier })).rejects.toBeInstanceOf(OAuthError);
    const b = await authorize();
    await expect(exchangeCode(db, { code: b.code, clientId: b.client.id, redirectUri: "https://claude.ai/autre", codeVerifier: b.verifier })).rejects.toBeInstanceOf(OAuthError);
    const c = await authorize();
    await expect(exchangeCode(db, { code: c.code, clientId: a.client.id, redirectUri: c.redirect, codeVerifier: c.verifier })).rejects.toBeInstanceOf(OAuthError);
  });

  it("demande d'autorisation invalide", async () => {
    const client = await registerClient(db, { redirect_uris: ["https://claude.ai/cb"] });
    const base = { clientId: client.id, redirectUri: "https://claude.ai/cb", codeChallenge: pkce().challenge, codeChallengeMethod: "S256", scope: "", resource: null, responseType: "code" };
    await expect(validateAuthorize(db, { ...base, codeChallengeMethod: "plain" })).rejects.toBeInstanceOf(OAuthError);
    await expect(validateAuthorize(db, { ...base, redirectUri: "https://claude.ai/autre" })).rejects.toBeInstanceOf(OAuthError);
    await expect(validateAuthorize(db, { ...base, scope: "ecriture" })).rejects.toBeInstanceOf(OAuthError);
    await expect(validateAuthorize(db, { ...base, clientId: "inconnu" })).rejects.toBeInstanceOf(OAuthError);
    await expect(registerClient(db, { redirect_uris: ["http://evil.fr/cb"] })).rejects.toBeInstanceOf(OAuthError);
  });

  it("rafraîchissement avec rotation ; réutiliser un ancien jeton révoque l'autorisation", async () => {
    const { client, code, verifier, redirect } = await authorize();
    const t1 = await exchangeCode(db, { code, clientId: client.id, redirectUri: redirect, codeVerifier: verifier });
    const t2 = await refreshTokens(db, { refreshToken: t1.refresh_token, clientId: client.id });
    expect(t2.access_token).not.toBe(t1.access_token);
    expect(await verifyBearer(db, t2.access_token)).not.toBeNull();
    await expect(refreshTokens(db, { refreshToken: t1.refresh_token, clientId: client.id })).rejects.toBeInstanceOf(OAuthError);
    // Toute l'autorisation est révoquée
    expect(await verifyBearer(db, t2.access_token)).toBeNull();
    expect(await verifyBearer(db, t1.access_token)).toBeNull();
    await expect(refreshTokens(db, { refreshToken: t2.refresh_token, clientId: client.id })).rejects.toBeInstanceOf(OAuthError);
  });

  it("révocation d'une application depuis la page ou par RFC 7009", async () => {
    const a = await authorize();
    const t = await exchangeCode(db, { code: a.code, clientId: a.client.id, redirectUri: a.redirect, codeVerifier: a.verifier });
    const [grant] = await listAccess(db, userId);
    expect(await revokeAccess(db, userId, grant.id)).toBe(true);
    expect(await verifyBearer(db, t.access_token)).toBeNull();
    expect(await listAccess(db, userId)).toHaveLength(0);

    const b = await authorize();
    const t2 = await exchangeCode(db, { code: b.code, clientId: b.client.id, redirectUri: b.redirect, codeVerifier: b.verifier });
    await revokeByToken(db, t2.refresh_token);
    expect(await verifyBearer(db, t2.access_token)).toBeNull();
    await revokeByToken(db, "inconnu"); // silencieux
  });
});
