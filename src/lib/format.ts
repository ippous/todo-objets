const eur0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const fmtEur = (n: number | null | undefined) =>
  n == null ? "—" : Number.isInteger(n) ? eur0.format(n) : eur2.format(n);
export const fmtHours = (n: number | null | undefined) => (n == null ? "—" : `${num.format(n)} h`);
export const fmtNum = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
export const fmtDate = (iso: string | null | undefined) => (iso ? day.format(new Date(`${iso}T00:00:00Z`)) : "");

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

/** État de l'échéance pour l'affichage. */
export function dueState(due: string | null, status: string): "retard" | "proche" | null {
  if (!due || status === "fait") return null;
  const today = todayIso();
  if (due < today) return "retard";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  return due <= soon.toISOString().slice(0, 10) ? "proche" : null;
}
