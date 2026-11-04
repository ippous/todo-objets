// Calcul des rappels (logique pure, sans base : testable directement).
import type { ReminderOffset } from "@/db/schema";

export const TZ = "Europe/Paris";

/** Heure d'envoi des rappels « J-n » d'une tâche sans heure d'échéance. */
export const DAY_REMINDER_HOUR = 8;

export const UNIT_LABEL = { j: "J", h: "H", m: "M" } as const;
const UNIT_MINUTES = { j: 1440, h: 60, m: 1 } as const;
export const OFFSETS_MAX = 8;

/** « J-10 », « H-3 », « M-10 ». */
export const formatOffset = (o: ReminderOffset) => `${UNIT_LABEL[o.unit]}-${o.n}`;
export const formatOffsets = (list: ReminderOffset[]) => list.map(formatOffset).join(" / ");
export const offsetKey = (o: ReminderOffset) => `${o.unit}${o.n}`;

/** Du plus éloigné de l'échéance au plus proche, sans doublon. */
export function sortOffsets(list: ReminderOffset[]): ReminderOffset[] {
  const seen = new Set<string>();
  return list
    .filter((o) => (seen.has(offsetKey(o)) ? false : (seen.add(offsetKey(o)), true)))
    .sort((a, b) => b.n * UNIT_MINUTES[b.unit] - a.n * UNIT_MINUTES[a.unit]);
}

/**
 * Lit « J-10 / J-5 / H-3 / M-10 » (séparateurs : / , ; espaces ; « J10 » et « j-10 » acceptés).
 * J-0 = le jour même ; H et M doivent valoir au moins 1.
 */
export function parseOffsets(raw: string): { offsets: ReminderOffset[] } | { error: string } {
  const parts = raw
    .split(/[\/,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { error: "Indique au moins un rappel, par exemple J-1" };
  const offsets: ReminderOffset[] = [];
  for (const p of parts) {
    const m = /^([jhm])\s*-?\s*(\d{1,4})$/i.exec(p);
    if (!m) return { error: `« ${p} » n'est pas compris : écris J-10, H-3 ou M-10` };
    const unit = m[1].toLowerCase() as ReminderOffset["unit"];
    const n = Number(m[2]);
    if (unit !== "j" && n < 1) return { error: `« ${p} » : H et M valent au moins 1` };
    const max = { j: 365, h: 240, m: 1440 }[unit];
    if (n > max) return { error: `« ${p} » : ${UNIT_LABEL[unit]}-${max} au plus` };
    offsets.push({ n, unit });
  }
  const sorted = sortOffsets(offsets);
  if (sorted.length > OFFSETS_MAX) return { error: `${OFFSETS_MAX} rappels au plus par schéma` };
  return { offsets: sorted };
}

// ---------- Dates à Paris ----------

/** Décalage de Paris par rapport à UTC (en minutes) à cet instant. */
function parisOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Instant correspondant à une date et une heure de Paris (« 2026-11-20 », « 14:30 »). */
export function parisToUtc(date: string, hhmm: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let at = new Date(naive - parisOffsetMinutes(new Date(naive)) * 60000);
  // Second passage : le décalage peut changer autour du passage à l'heure d'été / d'hiver
  at = new Date(naive - parisOffsetMinutes(at) * 60000);
  return at;
}

/** « 2026-11-20 » moins n jours (calendrier, sans souci d'heure d'été). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** « 14:30:00 » → « 14:30 » ; vide → null. */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

/** Instant de l'échéance : l'heure fixée, ou la fin de la journée sans heure. */
export function dueInstant(dueDate: string, dueTime: string | null): Date {
  return dueTime ? parisToUtc(dueDate, hhmm(dueTime)!) : parisToUtc(addDays(dueDate, 1), "00:00");
}

/** Clé de l'échéance : « 2026-11-20 » ou « 2026-11-20T14:30 ». */
export const dueKey = (dueDate: string, dueTime: string | null) => (dueTime ? `${dueDate}T${hhmm(dueTime)}` : dueDate);

export type FireTime = { key: string; label: string; at: Date };

/**
 * Instants des rappels d'une échéance, du plus ancien au plus récent.
 * - avec une heure : l'échéance moins le décalage (J-1 = la veille à la même heure) ;
 * - sans heure : J-n le jour J-n à 8 h ; H et M ne s'appliquent pas.
 */
export function fireTimes(dueDate: string, dueTime: string | null, offsets: ReminderOffset[]): FireTime[] {
  const time = hhmm(dueTime);
  const out: FireTime[] = [];
  for (const o of offsets) {
    let at: Date;
    if (o.unit === "j") {
      at = time ? parisToUtc(addDays(dueDate, -o.n), time) : parisToUtc(addDays(dueDate, -o.n), `${String(DAY_REMINDER_HOUR).padStart(2, "0")}:00`);
    } else {
      if (!time) continue;
      at = new Date(parisToUtc(dueDate, time).getTime() - o.n * UNIT_MINUTES[o.unit] * 60000);
    }
    out.push({ key: offsetKey(o), label: formatOffset(o), at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Rappels à traiter maintenant : ceux dont l'instant est passé, avant l'échéance, pas encore traités.
 * Seul le plus récent est envoyé ; les plus anciens (manqués) sont marqués « sautés » pour ne pas
 * envoyer une rafale d'un coup. Un rappel dont l'instant précède `since` (dernière modification
 * de la tâche : création, échéance ou schéma changés) n'est pas envoyé : on ne prévient pas
 * « J-10 » pour une tâche créée la veille de son échéance.
 */
export function dueReminders(
  fires: FireTime[],
  deadline: Date,
  now: Date,
  done: Set<string>,
  since?: Date,
): { send: FireTime | null; skip: FireTime[] } {
  if (now >= deadline) return { send: null, skip: [] };
  const pending = fires.filter((f) => f.at <= now && !done.has(f.key));
  if (pending.length === 0) return { send: null, skip: [] };
  const last = pending[pending.length - 1];
  if (since && last.at < since) return { send: null, skip: pending };
  return { send: last, skip: pending.slice(0, -1) };
}

/** « dans 3 jours », « dans 2 h », « dans 10 min ». */
export function untilLabel(deadline: Date, now: Date): string {
  const min = Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 60000));
  if (min < 60) return `dans ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `dans ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "demain" : `dans ${d} jours`;
}
