"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { agenda, fromDay, layoutGantt, ticks, type Bar, type GanttScale, type GanttTask } from "@/lib/gantt";
import { fmtDate, STATUS_LABEL } from "@/lib/format";

const ROW = 34;
const HEAD = 44;
const GROUP = 28;
const LEFT = 232;
const SCALE_KEY = "carnet-gantt-echelle";

/**
 * Gantt des tâches filtrées : barres début → échéance groupées par objet, flèches d'enchaînement
 * (en rouge quand la tâche suivante commence avant la fin de celle qu'elle attend), ligne du jour.
 * Sur téléphone : liste chronologique.
 */
export function GanttView({
  tasks,
  edges,
  today,
  returnTo,
}: {
  tasks: GanttTask[];
  edges: { todoId: string; dependsOnId: string }[];
  today: string;
  returnTo: string;
}) {
  const [scale, setScale] = useState<GanttScale | null>(null);
  useEffect(() => {
    try {
      const s = localStorage.getItem(SCALE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- échelle mémorisée, lue après le premier rendu
      if (s === "jour" || s === "semaine" || s === "mois") setScale(s);
    } catch {}
  }, []);
  const layout = useMemo(() => layoutGantt(tasks, edges, today, scale ?? undefined), [tasks, edges, today, scale]);
  const sections = useMemo(() => agenda(tasks, today), [tasks, today]);
  const href = (id: string) => `/taches/${id}?retour=${encodeURIComponent(returnTo)}`;

  return (
    <>
      <div className="hidden gap-3 sm:grid">
        <GanttToolbar
          scale={layout.scale}
          onScale={(s) => {
            setScale(s);
            try {
              localStorage.setItem(SCALE_KEY, s);
            } catch {}
          }}
          conflicts={layout.conflicts}
        />
        {layout.groups.length ? (
          <GanttChart layout={layout} href={href} />
        ) : (
          <p className="rounded-xl border border-dashed border-line p-5 text-muted">
            Aucune de ces tâches n&apos;a de date : ajoute un début ou une échéance pour les placer dans le temps.
          </p>
        )}
        {layout.undated.length > 0 && (
          <details className="rounded-xl bg-surface px-4 py-3">
            <summary className="cursor-pointer font-bold">
              Sans date <span className="font-normal text-muted">({layout.undated.length})</span>
            </summary>
            <ul className="mt-2 grid gap-1">
              {layout.undated.map((t) => (
                <li key={t.id} className="text-sm">
                  <Link href={href(t.id)} className="font-bold text-moss underline-offset-4 hover:underline">
                    {t.title}
                  </Link>{" "}
                  <span className="text-muted">· {t.objectName}</span>
                  {t.blocked && t.status !== "fait" && <span className="ml-2 rounded bg-ochre-soft px-1 font-bold text-ochre">Bloquée</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Téléphone : liste chronologique */}
      <div className="grid gap-4 sm:hidden">
        {sections.map((s) => (
          <section key={s.key} aria-labelledby={`agenda-${s.key}`} className="grid gap-1">
            <h2 id={`agenda-${s.key}`} className={`text-sm font-bold ${s.key === "retard" ? "text-brick" : "text-muted"}`}>
              {s.label} ({s.tasks.length})
            </h2>
            <ul className="rounded-xl bg-surface px-3">
              {s.tasks.map((t) => (
                <li key={t.id} className="border-b border-line py-2 last:border-b-0">
                  <Link href={href(t.id)} className={`font-bold underline-offset-4 hover:underline ${t.status === "fait" ? "text-muted line-through" : ""}`}>
                    {t.title}
                  </Link>
                  <p className="flex flex-wrap gap-x-2 text-sm text-muted">
                    <span className="text-moss">{t.objectName}</span>
                    {(t.startDate || t.dueDate) && (
                      <span className={t.late ? "font-bold text-brick" : ""}>
                        {t.startDate && t.dueDate && t.startDate !== t.dueDate
                          ? `${fmtDate(t.startDate)} → ${fmtDate(t.dueDate)}`
                          : fmtDate(t.dueDate ?? t.startDate)}
                      </span>
                    )}
                    {t.status === "en_cours" && <span>en cours</span>}
                    {t.blocked && t.status !== "fait" && <span className="rounded bg-ochre-soft px-1 font-bold text-ochre">Bloquée</span>}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <p className="text-muted">Aucune tâche.</p>}
      </div>
    </>
  );
}

function GanttToolbar({ scale, onScale, conflicts }: { scale: GanttScale; onScale: (s: GanttScale) => void; conflicts: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted">Échelle</span>
        <div className="flex rounded-lg bg-surface p-0.5" role="group" aria-label="Échelle">
          {(["jour", "semaine", "mois"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scale === s}
              onClick={() => onScale(s)}
              className={`rounded-md px-3 py-1.5 font-bold capitalize ${scale === s ? "bg-moss-soft text-moss" : "text-muted hover:text-ink"}`}
            >
              {s === "jour" ? "Jours" : s === "semaine" ? "Semaines" : "Mois"}
            </button>
          ))}
        </div>
      </div>
      <Legend />
      {conflicts > 0 && (
        <p role="status" className="rounded bg-brick-soft px-2 py-1 font-bold text-brick">
          {conflicts} enchaînement{conflicts > 1 ? "s" : ""} en conflit : une tâche commence avant la fin de celle qu&apos;elle attend
        </p>
      )}
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded-sm ${cls}`} aria-hidden />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 text-muted">
      {item("gantt-bar-a_faire", "À faire")}
      {item("gantt-bar-en_cours", "En cours")}
      {item("gantt-bar-fait", "Fait")}
      {item("gantt-bar-late", "En retard")}
      {item("gantt-bar-a_faire gantt-blocked", "Bloquée")}
    </div>
  );
}

function GanttChart({ layout, href }: { layout: ReturnType<typeof layoutGantt>; href: (id: string) => string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { start, end, pxPerDay: px, scale } = layout;
  const width = (end - start + 1) * px;
  const x = (day: number) => (day - start) * px;

  // Lignes : en-tête de groupe puis une ligne par tâche
  const rows: ({ kind: "group"; name: string; id: string } | { kind: "bar"; bar: Bar })[] = [];
  for (const g of layout.groups) {
    rows.push({ kind: "group", name: g.objectName, id: g.objectId });
    for (const b of g.bars) rows.push({ kind: "bar", bar: b });
  }
  const yOf = new Map<string, number>();
  let y = 0;
  const tops: number[] = [];
  for (const r of rows) {
    tops.push(y);
    if (r.kind === "bar") yOf.set(r.bar.id, y + ROW / 2);
    y += r.kind === "group" ? GROUP : ROW;
  }
  const height = y;
  const barById = new Map(layout.groups.flatMap((g) => g.bars).map((b) => [b.id, b]));
  const tk = useMemo(() => ticks(start, end, scale), [start, end, scale]);

  // Au chargement : aujourd'hui vers le premier tiers de la zone visible
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(layout.today) - el.clientWidth / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, start]);

  const weekend = (d: number) => {
    const wd = new Date(d * 86_400_000).getUTCDay();
    return wd === 0 || wd === 6;
  };

  return (
    <div className="flex overflow-hidden rounded-xl border border-line bg-surface text-sm">
      {/* Colonne des titres */}
      <div className="shrink-0 border-r border-line" style={{ width: LEFT }}>
        <div style={{ height: HEAD }} className="flex items-end border-b border-line px-3 pb-1 text-xs text-muted">
          Tâche
        </div>
        {rows.map((r) =>
          r.kind === "group" ? (
            <div key={`g-${r.id}`} style={{ height: GROUP }} className="flex items-center truncate bg-paper px-3 text-xs font-bold text-muted" title={r.name}>
              {r.name}
            </div>
          ) : (
            <div key={r.bar.id} style={{ height: ROW }} className="flex items-center gap-1.5 truncate px-3">
              <Link
                href={href(r.bar.id)}
                className={`truncate underline-offset-4 hover:underline ${r.bar.status === "fait" ? "text-muted line-through" : "font-bold"}`}
                title={`${r.bar.title} · ${STATUS_LABEL[r.bar.status]}`}
              >
                {r.bar.title}
              </Link>
              {r.bar.blocked && r.bar.status !== "fait" && (
                <span className="shrink-0 rounded bg-ochre-soft px-1 text-xs font-bold text-ochre" title="Attend des tâches qui ne sont pas faites">
                  bloquée
                </span>
              )}
            </div>
          ),
        )}
      </div>

      {/* Frise */}
      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ width, height: HEAD + height }}>
          {/* En-tête */}
          <div className="absolute inset-x-0 top-0 border-b border-line" style={{ height: HEAD }}>
            {tk.top.map((t) => (
              <span key={`t-${t.day}`} className="absolute top-1 border-l border-line pl-1 text-xs font-bold whitespace-nowrap" style={{ left: x(t.day) }}>
                {t.label}
              </span>
            ))}
            {tk.bottom.map((t) => (
              <span
                key={`b-${t.day}`}
                className="absolute bottom-1 text-center text-[11px] text-muted"
                style={{ left: x(t.day), width: scale === "jour" ? px : undefined }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {/* Fond : week-ends (échelle jour), bandes des groupes */}
          <div className="absolute inset-x-0" style={{ top: HEAD, height }}>
            {scale === "jour" &&
              Array.from({ length: end - start + 1 }, (_, i) => start + i)
                .filter(weekend)
                .map((d) => <div key={d} className="absolute inset-y-0 bg-paper" style={{ left: x(d), width: px }} />)}
            {rows.map((r, i) =>
              r.kind === "group" ? <div key={`gb-${r.id}`} className="absolute inset-x-0 bg-paper" style={{ top: tops[i], height: GROUP }} /> : null,
            )}
            {/* Aujourd'hui */}
            <div className="absolute inset-y-0 w-0.5 bg-brick/70" style={{ left: x(layout.today) + px / 2 }} title={`Aujourd'hui, ${fmtDate(fromDay(layout.today))}`} />
          </div>

          {/* Flèches */}
          <svg className="pointer-events-none absolute left-0" style={{ top: HEAD }} width={width} height={height} aria-hidden>
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--muted)" />
              </marker>
              <marker id="gantt-arrow-conflict" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--brick)" />
              </marker>
            </defs>
            {layout.edges.map((e) => {
              const pre = barById.get(e.from)!;
              const next = barById.get(e.to)!;
              const x1 = pre.milestone ? x(pre.to) + px / 2 + 6 : x(pre.to + 1);
              const y1 = yOf.get(e.from)!;
              const x2 = next.milestone ? x(next.from) + px / 2 - 7 : x(next.from);
              const y2 = yOf.get(e.to)!;
              const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 16));
              const d =
                x2 - 8 > x1
                  ? `M${x1},${y1} H${mid} V${y2} H${x2}`
                  : // Le suivant commence avant la fin : on contourne par-dessous
                    `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2}`;
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={d}
                  fill="none"
                  stroke={e.conflict ? "var(--brick)" : "var(--muted)"}
                  strokeWidth={e.conflict ? 1.6 : 1.2}
                  strokeDasharray={e.conflict ? "4 3" : undefined}
                  markerEnd={`url(#${e.conflict ? "gantt-arrow-conflict" : "gantt-arrow"})`}
                />
              );
            })}
          </svg>

          {/* Barres */}
          {rows.map((r, i) => {
            if (r.kind !== "bar") return null;
            const b = r.bar;
            const top = HEAD + tops[i];
            const cls = `${b.late ? "gantt-bar-late" : `gantt-bar-${b.status}`} ${b.blocked && b.status !== "fait" ? "gantt-blocked" : ""}`;
            const dates =
              b.startDate && b.dueDate && b.startDate !== b.dueDate
                ? `${fmtDate(b.startDate)} → ${fmtDate(b.dueDate)}`
                : fmtDate(b.dueDate ?? b.startDate);
            const tip = `${b.title}\n${b.objectName} · ${STATUS_LABEL[b.status]}${b.late ? " · en retard" : ""}${b.blocked && b.status !== "fait" ? " · bloquée" : ""}\n${dates}${b.milestone && !b.dueDate ? " (début)" : ""}`;
            if (b.milestone) {
              return (
                <Link
                  key={b.id}
                  href={href(b.id)}
                  title={tip}
                  aria-label={`${b.title}, ${dates}`}
                  className="absolute flex items-center"
                  style={{ left: x(b.from) + px / 2 - 7, top: top + ROW / 2 - 7, height: 14 }}
                >
                  <span className={`block size-3.5 rotate-45 rounded-[2px] ${cls}`} />
                  <span className="ml-2 truncate text-xs whitespace-nowrap text-muted">{b.title}</span>
                </Link>
              );
            }
            const w = (b.to - b.from + 1) * px;
            return (
              <Link
                key={b.id}
                href={href(b.id)}
                title={tip}
                aria-label={`${b.title}, ${dates}`}
                className={`absolute flex items-center overflow-hidden rounded-md px-1.5 text-xs font-bold whitespace-nowrap ${cls}`}
                style={{ left: x(b.from), width: Math.max(w, 6), top: top + 7, height: ROW - 14 }}
              >
                {w > 60 ? <span className="truncate">{b.title}</span> : null}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
