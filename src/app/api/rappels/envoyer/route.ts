// Envoi des rappels arrivés à échéance. À appeler toutes les 1 à 5 minutes par une tâche planifiée
// (cron du VPS, cron-job.org, ou Vercel Cron sur un plan qui l'autorise), avec
// l'en-tête « Authorization: Bearer <CRON_SECRET> ».
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { configuredSenders } from "@/lib/notify";
import { runReminders } from "@/lib/reminder-repo";
import { deleteExpiredPieces } from "@/lib/chat-pieces";
import { lireProchainRappel, noterProchainRappel } from "@/lib/reminder-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  const now = new Date();
  // Aucun rappel avant l'instant noté : on laisse la base dormir (voir reminder-gate.ts)
  const veille = await lireProchainRappel();
  if (veille && now < veille) return Response.json({ en_veille: true, jusqu_a: veille.toISOString() });

  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const summary = await runReminders(getDb(), { now, senders: configuredSenders(), origin });
  // Ménage : pièces jointes du chat de plus de 7 jours
  const pieces_effacees = await deleteExpiredPieces(getDb()).catch((err) => (console.error("pieces", err), 0));
  const jusqu_a = await noterProchainRappel(summary.prochain, now);
  return Response.json({ ...summary, prochain: summary.prochain?.toISOString() ?? null, pieces_effacees, en_veille_jusqu_a: jusqu_a.toISOString() });
}

export const GET = handle;
export const POST = handle;
