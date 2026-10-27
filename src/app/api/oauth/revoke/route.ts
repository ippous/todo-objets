// Révocation de jeton (RFC 7009).
import { getDb } from "@/db";
import { revokeByToken } from "@/lib/oauth";
import { json, preflight, readParams } from "@/lib/oauth-http";

export async function POST(request: Request) {
  const p = await readParams(request);
  if (p.token) await revokeByToken(getDb(), p.token);
  return json({});
}
export const OPTIONS = preflight;
