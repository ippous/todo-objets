// Abonnement de l'appareil courant aux notifications (Web Push).
import { getDb } from "@/db";
import { deletePushSubscriptionByEndpoint, DomainError, savePushSubscription, type PushKeys } from "@/lib/reminder-repo";
import { getCurrentUser } from "@/lib/session";

function deviceLabel(ua: string) {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone / iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "Appareil";
  const nav = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navigateur";
  return `${nav} sur ${os}`;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 });
  const sub = (await request.json().catch(() => null)) as PushKeys | null;
  if (!sub || typeof sub.endpoint !== "string") return Response.json({ error: "Abonnement invalide" }, { status: 400 });
  try {
    await savePushSubscription(getDb(), user.id, sub, deviceLabel(request.headers.get("user-agent") ?? ""));
  } catch (err) {
    if (err instanceof DomainError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Non connecté" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return Response.json({ error: "endpoint requis" }, { status: 400 });
  await deletePushSubscriptionByEndpoint(getDb(), user.id, body.endpoint);
  return Response.json({ ok: true });
}
