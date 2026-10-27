// Métadonnées de ressource protégée (RFC 9728) : indique aux clients MCP où s'autoriser.
import { json, originOf, preflight, protectedResourceMetadata } from "@/lib/oauth-http";

export function GET(request: Request) {
  return json(protectedResourceMetadata(originOf(request)));
}
export const OPTIONS = preflight;
