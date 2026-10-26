// ROUTE TEMPORAIRE : copie des données du dev vers la prod. À supprimer après usage.
// - GET  (dev uniquement, session requise) : exporte toutes les tables en JSON.
// - POST (prod uniquement, jeton IMPORT_TOKEN requis) : sauvegarde la prod, copie les
//   fichiers preview/ → production/, puis remplace toutes les données par l'export.
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { devLoginEnabled } from "@/auth";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/session";

export const maxDuration = 60;

// Ordre d'insertion (parents d'abord)
const TABLES = ["users", "object_types", "document_types", "objects", "todos", "photos", "documents", "links"] as const;
type Dump = Record<(typeof TABLES)[number], Record<string, unknown>[]>;

async function dumpAll(): Promise<Dump> {
  const db = getDb();
  const out = {} as Dump;
  for (const t of TABLES) {
    const res = await db.execute(sql.raw(`SELECT coalesce(json_agg(x), '[]'::json) AS rows FROM "${t}" x`));
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { rows: Record<string, unknown>[] }[];
    out[t] = rows[0].rows;
  }
  return out;
}

export async function GET() {
  if (!devLoginEnabled) return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return Response.json({ error: "Non connecté" }, { status: 401 });
  return Response.json(await dumpAll());
}

function tokenOk(given: string | null) {
  const expected = process.env.IMPORT_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const toProd = (p: unknown) => (typeof p === "string" && p.startsWith("preview/") ? `production/${p.slice(8)}` : p);

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "production" || !process.env.IMPORT_TOKEN) return new Response("Not found", { status: 404 });
  if (!tokenOk(request.headers.get("x-import-token"))) return new Response("Not found", { status: 404 });

  const data = (await request.json()) as Dump;
  for (const t of TABLES) if (!Array.isArray(data[t])) return Response.json({ error: `table ${t} absente` }, { status: 400 });

  const backup = await dumpAll();

  // 1. Fichiers : copie des blobs du dev sous le préfixe de prod
  const { copy } = await import("@vercel/blob");
  const sources = [
    ...data.photos.flatMap((p) => [p.pathname, p.thumb_pathname]),
    ...data.documents.map((d) => d.pathname),
  ].filter((p): p is string => typeof p === "string" && p.startsWith("preview/"));
  const failed: string[] = [];
  for (const src of sources) {
    try {
      await copy(src, toProd(src) as string, { access: "private", addRandomSuffix: false, allowOverwrite: true });
    } catch (err) {
      console.error("[transfert] copie impossible", src, err);
      failed.push(src);
    }
  }
  if (failed.length) return Response.json({ error: "copie de fichiers incomplète", failed, backup }, { status: 500 });

  for (const p of data.photos) {
    p.pathname = toProd(p.pathname);
    p.thumb_pathname = toProd(p.thumb_pathname);
  }
  for (const d of data.documents) d.pathname = toProd(d.pathname);

  // 2. Base : tout remplacer dans une seule transaction
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`));
    for (const t of TABLES) {
      if (data[t].length === 0) continue;
      await tx.execute(
        sql`INSERT INTO ${sql.identifier(t)} SELECT * FROM json_populate_recordset(NULL::${sql.identifier(t)}, ${JSON.stringify(data[t])}::json)`,
      );
    }
  });

  const counts = Object.fromEntries(TABLES.map((t) => [t, data[t].length]));
  return Response.json({ ok: true, counts, files: sources.length, backup });
}
