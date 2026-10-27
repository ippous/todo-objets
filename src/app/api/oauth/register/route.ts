// Enregistrement dynamique des clients OAuth (RFC 7591) : clients publics avec PKCE.
import { getDb } from "@/db";
import { registerClient } from "@/lib/oauth";
import { json, oauthErrorResponse, preflight } from "@/lib/oauth-http";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "invalid_client_metadata", error_description: "Corps JSON attendu" }, 400);
    const client = await registerClient(getDb(), body);
    return json(
      {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "lecture",
      },
      201,
    );
  } catch (err) {
    return oauthErrorResponse(err);
  }
}
export const OPTIONS = preflight;
