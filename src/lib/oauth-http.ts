import "server-only";
import { OAuthError, SCOPES } from "./oauth";

/** Origine publique (https://todo.jaume-eric.com) d'après la requête. */
export function originOf(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export const MCP_PATH = "/api/mcp";

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

export function oauthErrorResponse(err: unknown) {
  if (err instanceof OAuthError) return json({ error: err.error, error_description: err.description }, err.status);
  console.error("[oauth]", err);
  return json({ error: "server_error", error_description: "Erreur interne" }, 500);
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Carnet",
    resource_documentation: `${origin}/connexion-ia`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/autoriser`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SCOPES],
    service_documentation: `${origin}/connexion-ia`,
  };
}

/** Paramètres d'un formulaire (application/x-www-form-urlencoded) ou d'un corps JSON. */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
  } else {
    const fd = new URLSearchParams(await request.text());
    for (const [k, v] of fd) out[k] = v;
  }
  // client_id transmis en authentification Basic (client_secret ignoré : clients publics)
  const auth = request.headers.get("authorization");
  if (!out.client_id && auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    out.client_id = decodeURIComponent(decoded.split(":")[0] ?? "");
  }
  return out;
}
