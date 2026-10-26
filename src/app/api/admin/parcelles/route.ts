// ROUTE TEMPORAIRE : ajout des parcelles sous « Le Moulin Frat › Pâtures » en prod. À supprimer après usage.
import { timingSafeEqual } from "node:crypto";
import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { objects } from "@/db/schema";
import { typeIdByName } from "@/lib/repo";

type Item = { name: string; description: string };

function tokenOk(given: string | null) {
  const expected = process.env.IMPORT_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "production" || !tokenOk(request.headers.get("x-import-token")))
    return new Response("Not found", { status: 404 });
  const { items, dryRun } = (await request.json()) as { items: Item[]; dryRun?: boolean };
  if (!Array.isArray(items) || items.some((i) => !i.name?.trim() || i.name.length > 120))
    return Response.json({ error: "items invalides" }, { status: 400 });

  const db = getDb();
  return db.transaction(async (tx) => {
    const [root] = await tx
      .select({ id: objects.id })
      .from(objects)
      .where(and(isNull(objects.parentId), ilike(objects.name, "le moulin frat")));
    if (!root) return Response.json({ error: "« Le Moulin Frat » introuvable" }, { status: 404 });
    const [parent] = await tx
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.parentId, root.id), ilike(objects.name, "pâtures")))
      .for("update");
    if (!parent) return Response.json({ error: "« Pâtures » introuvable sous « Le Moulin Frat »" }, { status: 404 });

    const existing = new Set(
      (await tx.select({ name: objects.name }).from(objects).where(eq(objects.parentId, parent.id))).map((o) => o.name),
    );
    const todo = items.filter((i) => !existing.has(i.name.trim()));
    if (dryRun || todo.length === 0)
      return Response.json({ dryRun: Boolean(dryRun), toCreate: todo.length, skipped: items.length - todo.length });

    const typeId = await typeIdByName(tx as unknown as Parameters<typeof typeIdByName>[0], "objet", "terrain");
    const [{ max }] = await tx
      .select({ max: sql<number | null>`max(${objects.position})` })
      .from(objects)
      .where(eq(objects.parentId, parent.id));
    const start = (max ?? -1) + 1;
    const created = await tx
      .insert(objects)
      .values(
        todo.map((i, k) => ({
          name: i.name.trim(),
          description: i.description,
          parentId: parent.id,
          typeId,
          position: start + k,
        })),
      )
      .returning({ name: objects.name });
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(objects)
      .where(eq(objects.parentId, parent.id));
    return Response.json({ created: created.length, skipped: items.length - todo.length, childrenNow: n });
  });
}
