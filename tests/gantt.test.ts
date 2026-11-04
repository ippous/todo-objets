import { describe, expect, it } from "vitest";
import { agenda, autoScale, barOf, layoutGantt, ticks, toDay, type GanttTask } from "@/lib/gantt";

const t = (id: string, startDate: string | null, dueDate: string | null, extra: Partial<GanttTask> = {}): GanttTask => ({
  id,
  title: id,
  status: "a_faire",
  startDate,
  dueDate,
  objectId: "o1",
  objectName: "Grange",
  blocked: false,
  ...extra,
});

describe("Gantt", () => {
  it("barre début → échéance, jalon avec une seule date, rien sans date", () => {
    expect(barOf(t("a", "2026-11-02", "2026-11-06"), "2026-11-04")).toMatchObject({ from: toDay("2026-11-02"), to: toDay("2026-11-06"), milestone: false, late: false });
    expect(barOf(t("b", null, "2026-11-01"), "2026-11-04")).toMatchObject({ milestone: true, late: true });
    expect(barOf(t("c", null, "2026-11-01", { status: "fait" }), "2026-11-04")!.late).toBe(false);
    expect(barOf(t("d", "2026-11-10", null), "2026-11-04")).toMatchObject({ milestone: true, from: toDay("2026-11-10") });
    expect(barOf(t("e", null, null), "2026-11-04")).toBeNull();
  });

  it("échelle selon l'étendue, groupes par objet et dans l'ordre du temps", () => {
    expect([autoScale(20), autoScale(120), autoScale(400)]).toEqual(["jour", "semaine", "mois"]);
    const l = layoutGantt(
      [
        t("semer", "2026-11-20", "2026-11-22", { objectId: "o2", objectName: "Pâture" }),
        t("demonter", "2026-11-05", "2026-11-08"),
        t("labourer", "2026-11-10", "2026-11-12", { objectId: "o2", objectName: "Pâture" }),
        t("sans", null, null),
      ],
      [],
      "2026-11-04",
    );
    expect(l.scale).toBe("jour");
    expect(l.groups.map((g) => [g.objectName, g.bars.map((b) => b.id)])).toEqual([
      ["Grange", ["demonter"]],
      ["Pâture", ["labourer", "semer"]],
    ]);
    expect(l.undated.map((u) => u.id)).toEqual(["sans"]);
    expect(l.start).toBeLessThan(toDay("2026-11-04"));
    expect(l.end).toBeGreaterThan(toDay("2026-11-22"));
  });

  it("signale l'enchaînement en conflit (le suivant commence avant la fin du précédent)", () => {
    const l = layoutGantt(
      [t("a", "2026-11-05", "2026-11-10"), t("b", "2026-11-08", "2026-11-12"), t("c", "2026-11-10", "2026-11-15")],
      [
        { todoId: "b", dependsOnId: "a" },
        { todoId: "c", dependsOnId: "a" },
      ],
      "2026-11-04",
    );
    expect(l.edges).toEqual([
      { from: "a", to: "b", conflict: true },
      { from: "a", to: "c", conflict: false },
    ]);
    expect(l.conflicts).toBe(1);
  });

  it("graduations et vue mobile chronologique", () => {
    const { top, bottom } = ticks(toDay("2026-10-30"), toDay("2026-11-03"), "jour");
    expect(top.map((x) => x.label)).toEqual(["oct. 2026", "nov. 2026"]);
    expect(bottom.map((x) => x.label)).toEqual(["30", "31", "1", "2", "3"]);
    const s = agenda(
      [
        t("retard", null, "2026-11-01"),
        t("semaine", null, "2026-11-06"),
        t("mois", null, "2026-11-25"),
        t("tard", "2027-01-05", null),
        t("sans", null, null),
        t("fait", null, "2026-11-02", { status: "fait" }),
      ],
      "2026-11-04",
    );
    expect(s.map((x) => [x.key, x.tasks.map((y) => y.id)])).toEqual([
      ["retard", ["retard"]],
      ["semaine", ["semaine"]],
      ["mois", ["mois"]],
      ["plus-tard", ["tard"]],
      ["sans-date", ["sans"]],
      ["faites", ["fait"]],
    ]);
  });
});

describe("avancement", () => {
  it("tâches et heures faites, fin prévue, retards et blocages", async () => {
    const { progressOf } = await import("@/lib/gantt");
    const p = progressOf(
      [
        { status: "fait", startDate: "2026-10-01", dueDate: "2026-10-05", estHours: 4, blockedBy: 0 },
        { status: "en_cours", startDate: null, dueDate: "2026-11-01", estHours: 2, blockedBy: 0 },
        { status: "a_faire", startDate: null, dueDate: "2026-12-15", estHours: 2, blockedBy: 1 },
        { status: "a_faire", startDate: null, dueDate: null, estHours: null, blockedBy: 0 },
      ],
      "2026-11-04",
    );
    expect(p).toMatchObject({ total: 4, done: 1, pct: 25, hoursPct: 50, start: "2026-10-01", plannedEnd: "2026-12-15", late: 1, blocked: 1 });
  });
});
