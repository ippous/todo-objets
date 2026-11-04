// Rappels : schémas, préférences, appareils abonnés et envoi.
// Chaque fonction reçoit la base (testable sur PGlite) ; l'envoi reçoit ses « expéditeurs ».
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  objects,
  pushSubscriptions,
  reminderDeliveries,
  reminderSchemes,
  todos,
  users,
  type PushSubscriptionRow,
  type ReminderOffset,
  type ReminderScheme,
} from "@/db/schema";
import { fmtDue } from "./format";
import { addDays, dueInstant, dueKey, dueReminders, fireTimes, sortOffsets, TZ, untilLabel } from "./reminders";
import { DomainError } from "./repo";

export { DomainError };

// ---------- Schémas (administrateurs) ----------

export type SchemeWithUsage = ReminderScheme & { usage: number };

export async function listReminderSchemes(db: Db): Promise<SchemeWithUsage[]> {
  const rows = await db
    .select({
      scheme: reminderSchemes,
      usage: sql<number>`(SELECT count(*)::int FROM todos t WHERE t.reminder_scheme_id = reminder_schemes.id AND t.status <> 'fait')`,
    })
    .from(reminderSchemes)
    .orderBy(sql`${reminderSchemes.isDefault} DESC`, asc(reminderSchemes.name));
  return rows.map((r) => ({ ...r.scheme, usage: Number(r.usage) }));
}

export async function getDefaultSchemeId(db: Db): Promise<string | null> {
  const [row] = await db.select({ id: reminderSchemes.id }).from(reminderSchemes).where(eq(reminderSchemes.isDefault, true));
  return row?.id ?? null;
}

export async function findSchemeByName(db: Db, name: string): Promise<ReminderScheme | undefined> {
  const [row] = await db.select().from(reminderSchemes).where(sql`lower(${reminderSchemes.name}) = lower(${name.trim()})`);
  return row;
}

function checkScheme(name: string, offsets: ReminderOffset[]) {
  if (!name.trim()) throw new DomainError("Le nom est obligatoire");
  if (name.length > 60) throw new DomainError("Nom trop long (60 caractères au plus)");
  if (offsets.length === 0) throw new DomainError("Indique au moins un rappel");
}

async function nameTaken(db: Db, name: string, exceptId?: string) {
  const found = await findSchemeByName(db, name);
  return !!found && found.id !== exceptId;
}

export async function createReminderScheme(db: Db, data: { name: string; offsets: ReminderOffset[]; isDefault?: boolean }) {
  checkScheme(data.name, data.offsets);
  if (await nameTaken(db, data.name)) throw new DomainError(`Le schéma « ${data.name.trim()} » existe déjà`);
  return db.transaction(async (tx) => {
    if (data.isDefault) await tx.update(reminderSchemes).set({ isDefault: false }).where(eq(reminderSchemes.isDefault, true));
    const [row] = await tx
      .insert(reminderSchemes)
      .values({ name: data.name.trim(), offsets: sortOffsets(data.offsets), isDefault: !!data.isDefault })
      .returning();
    return row;
  });
}

export async function updateReminderScheme(db: Db, id: string, data: { name: string; offsets: ReminderOffset[] }) {
  checkScheme(data.name, data.offsets);
  if (await nameTaken(db, data.name, id)) throw new DomainError(`Le schéma « ${data.name.trim()} » existe déjà`);
  const res = await db
    .update(reminderSchemes)
    .set({ name: data.name.trim(), offsets: sortOffsets(data.offsets) })
    .where(eq(reminderSchemes.id, id))
    .returning({ id: reminderSchemes.id });
  if (!res.length) throw new DomainError("Schéma introuvable");
}

/** Schéma proposé par défaut pour les nouvelles tâches (null : aucun). */
export async function setDefaultScheme(db: Db, id: string | null) {
  await db.transaction(async (tx) => {
    await tx.update(reminderSchemes).set({ isDefault: false }).where(eq(reminderSchemes.isDefault, true));
    if (id) {
      const res = await tx.update(reminderSchemes).set({ isDefault: true }).where(eq(reminderSchemes.id, id)).returning({ id: reminderSchemes.id });
      if (!res.length) throw new DomainError("Schéma introuvable");
    }
  });
}

/** Supprime un schéma : les tâches qui l'utilisaient n'ont plus de rappel. */
export async function deleteReminderScheme(db: Db, id: string) {
  await db.delete(reminderSchemes).where(eq(reminderSchemes.id, id));
}

// ---------- Préférences et appareils ----------

export async function setNotifyPrefs(db: Db, userId: string, prefs: { email?: boolean; push?: boolean }) {
  const set: Partial<{ notifyEmail: boolean; notifyPush: boolean }> = {};
  if (prefs.email !== undefined) set.notifyEmail = prefs.email;
  if (prefs.push !== undefined) set.notifyPush = prefs.push;
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, userId));
}

export type PushKeys = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Enregistre (ou rattache à cet utilisateur) l'abonnement d'un appareil. */
export async function savePushSubscription(db: Db, userId: string, sub: PushKeys, label: string) {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 2000) throw new DomainError("Abonnement invalide");
  if (!sub.keys?.p256dh || !sub.keys?.auth) throw new DomainError("Abonnement invalide");
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: label.slice(0, 80) })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: label.slice(0, 80) },
    });
}

export async function listPushSubscriptions(db: Db, userId: string): Promise<PushSubscriptionRow[]> {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(asc(pushSubscriptions.createdAt));
}

export async function deletePushSubscription(db: Db, userId: string, id: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)));
}

export async function deletePushSubscriptionByEndpoint(db: Db, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
}

// ---------- Envoi ----------

export type ReminderMessage = { title: string; body: string; url: string; tag: string };

export type Senders = {
  /** Absent : l'e-mail n'est pas configuré. */
  email?: (to: { email: string; name: string }, msg: ReminderMessage) => Promise<void>;
  /** Absent : les notifications ne sont pas configurées. « gone » : abonnement expiré, à supprimer. */
  push?: (sub: PushSubscriptionRow, msg: ReminderMessage) => Promise<"ok" | "gone">;
};

export type DeliveryOutcome = "envoye" | "saute" | "aucun_canal" | "aucun_destinataire" | "echec";

export type RunSummary = {
  examinees: number;
  envoyes: number;
  sautes: number;
  sans_canal: number;
  echecs: number;
  details: { tache: string; rappel: string; resultat: DeliveryOutcome; canaux: string[]; erreur?: string }[];
};

const parisToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);

/** Destinataire et canaux d'un envoi : ce que chaque canal a donné. */
async function deliver(
  db: Db,
  user: { id: string; email: string; name: string; notifyEmail: boolean; notifyPush: boolean },
  msg: ReminderMessage,
  senders: Senders,
): Promise<{ channels: string[]; errors: string[]; tried: number }> {
  const channels: string[] = [];
  const errors: string[] = [];
  let tried = 0;
  if (user.notifyEmail && senders.email) {
    tried++;
    try {
      await senders.email({ email: user.email, name: user.name }, msg);
      channels.push("email");
    } catch (err) {
      errors.push(`e-mail : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (user.notifyPush && senders.push) {
    const subs = await listPushSubscriptions(db, user.id);
    for (const sub of subs) {
      tried++;
      try {
        const r = await senders.push(sub, msg);
        if (r === "gone") {
          // Abonnement expiré : l'appareil ne compte plus
          tried--;
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          continue;
        }
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
        if (!channels.includes("notification")) channels.push("notification");
      } catch (err) {
        errors.push(`notification (${sub.label}) : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { channels, errors, tried };
}

/** Message d'un rappel. */
export function reminderMessage(
  t: { id: string; title: string; dueDate: string; dueTime: string | null; objectName: string },
  label: string,
  now: Date,
  origin: string,
): ReminderMessage {
  const deadline = dueInstant(t.dueDate, t.dueTime);
  const when = t.dueTime ? `${fmtDue(t.dueDate, t.dueTime)} (${untilLabel(deadline, now)})` : fmtDue(t.dueDate);
  return {
    title: `Rappel ${label} · ${t.title}`,
    body: `Échéance : ${when}\n${t.objectName}`,
    url: `${origin}/taches/${t.id}`,
    tag: `tache-${t.id}`,
  };
}

/**
 * Envoie les rappels arrivés à échéance. À appeler régulièrement (chaque minute idéalement).
 * Idempotent : un rappel n'est traité qu'une fois par échéance, même si deux appels se croisent.
 */
export async function runReminders(db: Db, opts: { now?: Date; senders: Senders; origin: string }): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const today = parisToday(now);
  const summary: RunSummary = { examinees: 0, envoyes: 0, sautes: 0, sans_canal: 0, echecs: 0, details: [] };

  // Tâches ouvertes avec un schéma et une échéance aujourd'hui ou dans l'année
  const candidates = await db
    .select({
      id: todos.id,
      title: todos.title,
      dueDate: todos.dueDate,
      dueTime: todos.dueTime,
      assigneeId: todos.assigneeId,
      createdById: todos.createdById,
      updatedAt: todos.updatedAt,
      objectName: objects.name,
      offsets: reminderSchemes.offsets,
    })
    .from(todos)
    .innerJoin(reminderSchemes, eq(reminderSchemes.id, todos.reminderSchemeId))
    .innerJoin(objects, eq(objects.id, todos.objectId))
    .where(
      and(
        ne(todos.status, "fait"),
        sql`${todos.dueDate} >= ${today}::date`,
        sql`${todos.dueDate} <= ${addDays(today, 366)}::date`,
      ),
    );
  if (candidates.length === 0) return summary;

  const done = await db
    .select({ todoId: reminderDeliveries.todoId, offsetKey: reminderDeliveries.offsetKey, dueKey: reminderDeliveries.dueKey })
    .from(reminderDeliveries)
    .where(inArray(reminderDeliveries.todoId, candidates.map((c) => c.id)));
  const doneKeys = new Map<string, Set<string>>();
  for (const d of done) {
    const k = `${d.todoId}|${d.dueKey}`;
    if (!doneKeys.has(k)) doneKeys.set(k, new Set());
    doneKeys.get(k)!.add(d.offsetKey);
  }

  const userIds = [...new Set(candidates.flatMap((c) => [c.assigneeId, c.createdById]).filter((x): x is string => !!x))];
  const people = userIds.length
    ? await db
        .select({ id: users.id, email: users.email, name: users.name, active: users.active, notifyEmail: users.notifyEmail, notifyPush: users.notifyPush })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  for (const t of candidates) {
    if (!t.dueDate) continue;
    summary.examinees++;
    const dk = dueKey(t.dueDate, t.dueTime);
    const fires = fireTimes(t.dueDate, t.dueTime, t.offsets);
    const { send, skip } = dueReminders(
      fires,
      dueInstant(t.dueDate, t.dueTime),
      now,
      doneKeys.get(`${t.id}|${dk}`) ?? new Set(),
      t.updatedAt,
    );
    if (!send && skip.length === 0) continue;

    for (const f of skip) {
      const ins = await db
        .insert(reminderDeliveries)
        .values({ todoId: t.id, offsetKey: f.key, dueKey: dk, outcome: "saute" })
        .onConflictDoNothing()
        .returning({ id: reminderDeliveries.id });
      if (ins.length) {
        summary.sautes++;
        summary.details.push({ tache: t.title, rappel: f.label, resultat: "saute", canaux: [] });
      }
    }

    if (!send) continue;

    // Réserve le rappel avant d'envoyer : un appel concurrent ne l'enverra pas une seconde fois
    const recipient = [t.assigneeId, t.createdById].map((id) => (id ? byId.get(id) : undefined)).find((u) => u?.active);
    const [claim] = await db
      .insert(reminderDeliveries)
      .values({ todoId: t.id, offsetKey: send.key, dueKey: dk, userId: recipient?.id ?? null, outcome: "envoi" })
      .onConflictDoNothing()
      .returning({ id: reminderDeliveries.id });
    if (!claim) continue;

    let outcome: DeliveryOutcome;
    let channels: string[] = [];
    let error: string | undefined;
    if (!recipient) {
      outcome = "aucun_destinataire";
    } else {
      const msg = reminderMessage({ ...t, dueDate: t.dueDate }, send.label, now, opts.origin);
      const r = await deliver(db, recipient, msg, opts.senders);
      channels = r.channels;
      error = r.errors.join(" ; ") || undefined;
      outcome = channels.length ? "envoye" : r.tried === 0 ? "aucun_canal" : "echec";
    }
    await db.update(reminderDeliveries).set({ outcome, channels, error: error ?? null }).where(eq(reminderDeliveries.id, claim.id));
    if (outcome === "envoye") summary.envoyes++;
    else if (outcome === "echec") summary.echecs++;
    else summary.sans_canal++;
    summary.details.push({ tache: t.title, rappel: send.label, resultat: outcome, canaux: channels, ...(error ? { erreur: error } : {}) });
  }
  return summary;
}

/** Derniers rappels traités pour une tâche (affichés sur sa fiche). */
export async function listTodoDeliveries(db: Db, todoId: string, limit = 10) {
  return db
    .select()
    .from(reminderDeliveries)
    .where(eq(reminderDeliveries.todoId, todoId))
    .orderBy(sql`${reminderDeliveries.at} DESC`)
    .limit(limit);
}

/** Prochains rappels prévus d'une tâche (pour l'affichage). */
export function upcomingFires(
  t: { dueDate: string | null; dueTime: string | null; status: string },
  offsets: ReminderOffset[] | null | undefined,
  now = new Date(),
) {
  if (!t.dueDate || !offsets || t.status === "fait") return [];
  const deadline = dueInstant(t.dueDate, t.dueTime);
  return fireTimes(t.dueDate, t.dueTime, offsets).filter((f) => f.at > now && f.at < deadline);
}
