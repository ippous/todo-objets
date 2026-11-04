// Mise en page du Gantt (logique pure, testable) : échelle, barres, groupes, flèches et conflits.

export type GanttTask = {
  id: string;
  title: string;
  status: "a_faire" | "en_cours" | "fait";
  startDate: string | null;
  dueDate: string | null;
  objectId: string;
  objectName: string;
  blocked: boolean;
};

export type GanttScale = "jour" | "semaine" | "mois";
export const SCALE_PX: Record<GanttScale, number> = { jour: 28, semaine: 9, mois: 2.6 };
const PAD_DAYS: Record<GanttScale, number> = { jour: 2, semaine: 7, mois: 20 };

const DAY = 86_400_000;
export const toDay = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Échelle proposée selon l'étendue des dates. */
export function autoScale(spanDays: number): GanttScale {
  return spanDays <= 45 ? "jour" : spanDays <= 240 ? "semaine" : "mois";
}

export type Bar = GanttTask & {
  /** Premier jour (inclus) et dernier jour (inclus), en jours depuis 1970. */
  from: number;
  to: number;
  /** Un seul jour sans début distinct : affiché en jalon (losange). */
  milestone: boolean;
  late: boolean;
};

/** Barre d'une tâche : début → échéance ; un seul des deux = jalon ; aucun = pas de barre. */
export function barOf(t: GanttTask, today: string): Bar | null {
  const s = t.startDate ? toDay(t.startDate) : null;
  const d = t.dueDate ? toDay(t.dueDate) : null;
  if (s == null && d == null) return null;
  const from = s ?? d!;
  const to = d ?? s!;
  return { ...t, from, to, milestone: s == null || d == null, late: t.status !== "fait" && d != null && d < toDay(today) };
}

export type GanttGroup = { objectId: string; objectName: string; bars: Bar[] };

export type GanttLayout = {
  scale: GanttScale;
  pxPerDay: number;
  start: number;
  end: number;
  today: number;
  groups: GanttGroup[];
  undated: GanttTask[];
  edges: { from: string; to: string; conflict: boolean }[];
  conflicts: number;
};

/**
 * Regroupe par objet (groupes et barres dans l'ordre chronologique) et calcule la fenêtre de temps.
 * Une flèche est « en conflit » quand la tâche suivante commence avant la fin de celle qu'elle attend.
 */
export function layoutGantt(
  tasks: GanttTask[],
  edges: { todoId: string; dependsOnId: string }[],
  today: string,
  scale?: GanttScale,
): GanttLayout {
  const t0 = toDay(today);
  const bars: Bar[] = [];
  const undated: GanttTask[] = [];
  for (const t of tasks) {
    const b = barOf(t, today);
    if (b) bars.push(b);
    else undated.push(t);
  }
  const min = Math.min(t0, ...bars.map((b) => b.from));
  const max = Math.max(t0, ...bars.map((b) => b.to));
  const chosen = scale ?? autoScale(max - min + 1);
  const pad = PAD_DAYS[chosen];

  const byObject = new Map<string, GanttGroup>();
  for (const b of [...bars].sort((x, y) => x.from - y.from || x.to - y.to || x.title.localeCompare(y.title, "fr"))) {
    if (!byObject.has(b.objectId)) byObject.set(b.objectId, { objectId: b.objectId, objectName: b.objectName, bars: [] });
    byObject.get(b.objectId)!.bars.push(b);
  }
  const groups = [...byObject.values()].sort((x, y) => x.bars[0].from - y.bars[0].from || x.objectName.localeCompare(y.objectName, "fr"));

  const barById = new Map(bars.map((b) => [b.id, b]));
  const drawn = edges
    .filter((e) => barById.has(e.todoId) && barById.has(e.dependsOnId))
    .map((e) => {
      const pre = barById.get(e.dependsOnId)!;
      const next = barById.get(e.todoId)!;
      // Le suivant ne doit pas commencer avant le dernier jour du précédent (le même jour est admis)
      const conflict = next.from < pre.to;
      return { from: e.dependsOnId, to: e.todoId, conflict };
    });

  return {
    scale: chosen,
    pxPerDay: SCALE_PX[chosen],
    start: min - pad,
    end: max + pad,
    today: t0,
    groups,
    undated,
    edges: drawn,
    conflicts: drawn.filter((e) => e.conflict).length,
  };
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Graduations de l'en-tête : une ligne haute (mois ou années) et une ligne basse (jours, semaines ou mois). */
export function ticks(start: number, end: number, scale: GanttScale): { top: { day: number; label: string }[]; bottom: { day: number; label: string }[] } {
  const top: { day: number; label: string }[] = [];
  const bottom: { day: number; label: string }[] = [];
  for (let d = start; d <= end; d++) {
    const iso = fromDay(d);
    const [y, m, dd] = iso.split("-").map(Number);
    const weekday = new Date(d * DAY).getUTCDay(); // 1 = lundi
    if (scale === "mois") {
      if (dd === 1 && m === 1) top.push({ day: d, label: String(y) });
      if (dd === 1) bottom.push({ day: d, label: MONTHS[m - 1] });
    } else {
      if (dd === 1) top.push({ day: d, label: `${MONTHS[m - 1]} ${y}` });
      if (scale === "jour") bottom.push({ day: d, label: String(dd) });
      else if (weekday === 1) bottom.push({ day: d, label: String(dd) });
    }
  }
  // Libellé de départ si la fenêtre ne commence pas un 1er
  if (!top.length || top[0].day > start) {
    const [y, m] = fromDay(start).split("-").map(Number);
    top.unshift({ day: start, label: scale === "mois" ? String(y) : `${MONTHS[m - 1]} ${y}` });
  }
  return { top, bottom };
}

export type AgendaSection = { key: string; label: string; tasks: (GanttTask & { late: boolean })[] };

/** Vue mobile : sections chronologiques (en retard, cette semaine, ce mois-ci, plus tard, faites, sans date). */
export function agenda(tasks: GanttTask[], today: string): AgendaSection[] {
  const t0 = toDay(today);
  const weekday = (new Date(t0 * DAY).getUTCDay() + 6) % 7; // 0 = lundi
  const endOfWeek = t0 + (6 - weekday);
  const [y, m] = today.split("-").map(Number);
  const endOfMonth = toDay(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  const sections: AgendaSection[] = [
    { key: "retard", label: "En retard", tasks: [] },
    { key: "semaine", label: "Cette semaine", tasks: [] },
    { key: "mois", label: "Ce mois-ci", tasks: [] },
    { key: "plus-tard", label: "Plus tard", tasks: [] },
    { key: "sans-date", label: "Sans date", tasks: [] },
    { key: "faites", label: "Faites", tasks: [] },
  ];
  const at = (k: string) => sections.find((s) => s.key === k)!.tasks;
  const keyDay = (t: GanttTask) => (t.dueDate ? toDay(t.dueDate) : t.startDate ? toDay(t.startDate) : null);
  const sorted = [...tasks].sort((a, b) => (keyDay(a) ?? Infinity) - (keyDay(b) ?? Infinity) || a.title.localeCompare(b.title, "fr"));
  for (const t of sorted) {
    const d = keyDay(t);
    const late = t.status !== "fait" && !!t.dueDate && toDay(t.dueDate) < t0;
    const item = { ...t, late };
    if (t.status === "fait") at("faites").push(item);
    else if (d == null) at("sans-date").push(item);
    else if (late) at("retard").push(item);
    else if (d <= endOfWeek) at("semaine").push(item);
    else if (d <= endOfMonth) at("mois").push(item);
    else at("plus-tard").push(item);
  }
  return sections.filter((s) => s.tasks.length);
}

export type Progress = {
  total: number;
  done: number;
  /** Part des tâches faites (0–100). */
  pct: number;
  /** Part des heures prévues des tâches faites (null sans durée prévue). */
  hoursPct: number | null;
  estHours: number;
  doneEstHours: number;
  /** Premier jour daté (début ou échéance) et échéance la plus tardive des tâches ouvertes. */
  start: string | null;
  plannedEnd: string | null;
  late: number;
  blocked: number;
};

/** Avancement d'un ensemble de tâches (un objet et son sous-arbre, vu comme un projet). */
export function progressOf(
  tasks: { status: string; startDate: string | null; dueDate: string | null; estHours: number | null; blockedBy: number }[],
  today: string,
): Progress {
  const done = tasks.filter((t) => t.status === "fait");
  const open = tasks.filter((t) => t.status !== "fait");
  const est = tasks.reduce((s, t) => s + (t.estHours ?? 0), 0);
  const doneEst = done.reduce((s, t) => s + (t.estHours ?? 0), 0);
  const dates = tasks.flatMap((t) => [t.startDate, t.dueDate]).filter((d): d is string => !!d).sort();
  const ends = open.map((t) => t.dueDate).filter((d): d is string => !!d).sort();
  return {
    total: tasks.length,
    done: done.length,
    pct: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
    hoursPct: est > 0 ? Math.round((doneEst / est) * 100) : null,
    estHours: Math.round(est * 100) / 100,
    doneEstHours: Math.round(doneEst * 100) / 100,
    start: dates[0] ?? null,
    plannedEnd: ends.at(-1) ?? null,
    late: open.filter((t) => t.dueDate && t.dueDate < today).length,
    blocked: open.filter((t) => t.blockedBy > 0).length,
  };
}
