const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const fmtEur = (n: number | null | undefined) =>
  n == null ? "—" : Number.isInteger(n) ? eur0.format(n) : eur2.format(n);
export const fmtHours = (n: number | null | undefined) => (n == null ? "—" : `${num.format(n)} h`);
export const fmtNum = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
export const fmtDate = (iso: string | null | undefined) => (iso ? day.format(new Date(`${iso}T00:00:00Z`)) : "");
/** « 20 nov. 2026 » ou « 20 nov. 2026 à 14:30 ». */
export const fmtDue = (date: string | null | undefined, time?: string | null) =>
  date ? (time ? `${fmtDate(date)} à ${time.slice(0, 5)}` : fmtDate(date)) : "";

export const STATUS_LABEL = { a_faire: "À faire", en_cours: "En cours", fait: "Fait" } as const;
export const PRIORITY_LABEL = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" } as const;
export const CATEGORY_LABEL = { entretien: "Entretien", travaux: "Travaux", administratif: "Administratif" } as const;
export const RECURRENCE_LABEL = {
  aucune: "Aucune",
  mensuelle: "Tous les mois",
  saisonniere: "Tous les 3 mois",
  annuelle: "Tous les ans",
} as const;

export function todayIso(): string {
  // Date du jour à Paris
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

/** Heure actuelle à Paris, « 14:30 ». */
export function nowHhmmParis(): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

/** Échéance dépassée : la date est passée, ou c'est aujourd'hui et l'heure fixée est passée. */
export function isOverdue(due: string | null, time: string | null | undefined, status: string): boolean {
  if (!due || status === "fait") return false;
  const today = todayIso();
  return due < today || (due === today && !!time && time.slice(0, 5) <= nowHhmmParis());
}

/** État de l'échéance pour l'affichage. */
export function dueState(due: string | null, status: string, time?: string | null): "retard" | "proche" | null {
  if (!due || status === "fait") return null;
  const today = todayIso();
  if (isOverdue(due, time, status)) return "retard";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  return due <= soon.toISOString().slice(0, 10) ? "proche" : null;
}
