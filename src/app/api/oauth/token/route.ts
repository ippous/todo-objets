// Point de jeton OAuth : code d'autorisation (PKCE) et rafraîchissement.
import { getDb } from "@/db";
import { exchangeCode, OAuthError, refreshTokens } from "@/lib/oauth";
import { json, oauthErrorResponse, preflight, readParams } from "@/lib/oauth-http";

export async function POST(request: Request) {
  try {
    const p = await readParams(request);
    if (!p.client_id) throw new OAuthError("invalid_client", "client_id manquant", 401);
    const db = getDb();
    if (p.grant_type === "authorization_code") {
      return json(
        await exchangeCode(db, {
          code: p.code ?? "",
          clientId: p.client_id,
          redirectUri: p.redirect_uri ?? "",
          codeVerifier: p.code_verifier ?? "",
        }),
      );
    }
    if (p.grant_type === "refresh_token") {
      return json(await refreshTokens(db, { refreshToken: p.refresh_token ?? "", clientId: p.client_id }));
    }
    throw new OAuthError("unsupported_grant_type", "grant_type non pris en charge");
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = preflight;
