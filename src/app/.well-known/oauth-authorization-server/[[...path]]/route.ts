// Métadonnées du serveur d'autorisation (RFC 8414).
import { authorizationServerMetadata, json, originOf, preflight } from "@/lib/oauth-http";

export function GET(request: Request) {
  return json(authorizationServerMetadata(originOf(request)));
}
export const OPTIONS = preflight;
