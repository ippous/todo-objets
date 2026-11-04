import "server-only";
// « Prête » : quand une tâche est faite, prévient le responsable de chaque tâche qui l'attendait
// et n'attend plus rien (mêmes canaux et préférences que les rappels).
import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { newlyReady } from "./dependencies";
import { configuredSenders } from "./notify";
import { deliver } from "./reminder-repo";

export async function notifyReady(db: Db, doneId: string, doneTitle: string, origin: string): Promise<number> {
  const senders = configuredSenders();
  if (!senders.email && !senders.push) return 0;
  const ready = await newlyReady(db, doneId);
  if (!ready.length) return 0;
  const ids = [...new Set(ready.flatMap((t) => [t.assigneeId, t.createdById]).filter((x): x is string => !!x))];
  const people = ids.length
    ? await db
        .select({ id: users.id, email: users.email, name: users.name, active: users.active, notifyEmail: users.notifyEmail, notifyPush: users.notifyPush })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  let sent = 0;
  for (const t of ready) {
    const who = [t.assigneeId, t.createdById].map((id) => (id ? byId.get(id) : undefined)).find((u) => u?.active);
    if (!who) continue;
    const r = await deliver(
      db,
      who,
      { title: `Prête · ${t.title}`, body: `« ${doneTitle} » est faite : tu peux commencer.`, url: `${origin}/taches/${t.id}`, tag: `prete-${t.id}` },
      senders,
    );
    if (r.channels.length) sent++;
  }
  return sent;
}
