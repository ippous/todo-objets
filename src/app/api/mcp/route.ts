// Serveur MCP (transport « Streamable HTTP », sans état) — lecture, et écriture selon les droits du jeton.
// Authentification : jeton OAuth ou jeton personnel dans « Authorization: Bearer … ».
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db";
import { buildMcpServer } from "@/lib/mcp-server";
import { verifyBearerAccess } from "@/lib/oauth";
import { CORS, MCP_PATH, originOf, preflight } from "@/lib/oauth-http";

export const maxDuration = 60;

function unauthorized(origin: string, description: string) {
  const metadata = `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="carnet", error="invalid_token", error_description="${description}", resource_metadata="${metadata}"`,
      ...CORS,
    },
  });
}

async function handle(request: Request): Promise<Response> {
  const origin = originOf(request);
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return unauthorized(origin, "Authentification requise");
  const db = getDb();
  const access = await verifyBearerAccess(db, token);
  if (!access) return unauthorized(origin, "Jeton invalide, expiré ou révoqué");

  const server = buildMcpServer(db, access.user, origin, access.write, access.client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } finally {
    // Sans état : rien à garder entre deux requêtes
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
