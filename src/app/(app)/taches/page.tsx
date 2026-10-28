import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, type FilterValues } from "@/components/filter-bar";
import { KanbanBoard, type KanbanLane } from "@/components/kanban-board";
import { TodoRow } from "@/components/todo-row";
import { getDb } from "@/db";
import { CATEGORIES, PRIORITIES, type Todo } from "@/db/schema";
import { fmtEur, fmtHours } from "@/lib/format";
import { objectOptions } from "@/lib/options";
import { computeTotals, listAllTags, listObjects, listTodos, listUsers, type TodoFilters, type TodoSort } from "@/lib/repo";
import { requireUser } from "@/lib/session";
import { groupByRoot } from "@/lib/tree";

export const metadata: Metadata = { title: "Tâches" };

const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TachesPage(props: PageProps<"/taches">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  // Vue liste (par défaut) ou tableau, avec ou sans couloirs par objet racine
  const board = one(sp.vue) === "tableau";
  const byRoot = board && one(sp.groupe) === "racine";
  const keep: Record<string, string> = board ? { vue: "tableau", ...(byRoot ? { groupe: "racine" } : {}) } : {};
  const values: FilterValues = {
    // Le tableau montre toujours les trois statuts
    statut: board ? "" : one(sp.statut),
    responsable: one(sp.responsable),
    categorie: one(sp.categorie),
    priorite: one(sp.priorite),
    tag: one(sp.tag),
    objet: one(sp.objet),
    avant: one(sp.avant),
    q: one(sp.q).slice(0, 100),
    tri: one(sp.tri),
  };

  const filters: TodoFilters = {
    statuses:
      board || values.statut === "toutes"
        ? undefined
        : values.statut === "a_faire" || values.statut === "en_cours" || values.statut === "fait"
          ? [values.statut as Todo["status"]]
          : ["a_faire", "en_cours"],
    assigneeId: values.responsable === "none" ? "none" : UUID.test(values.responsable) ? values.responsable : undefined,
    category: (CATEGORIES as readonly string[]).includes(values.categorie) ? (values.categorie as Todo["category"]) : undefined,
    priority: (PRIORITIES as readonly string[]).includes(values.priorite) ? (values.priorite as Todo["priority"]) : undefined,
    tag: values.tag || undefined,
    subtreeOf: UUID.test(values.objet) ? values.objet : undefined,
    dueBefore: /^\d{4}-\d{2}-\d{2}$/.test(values.avant) ? values.avant : undefined,
    q: values.q || undefined,
  };
  const sort: TodoSort = (["priorite", "ratio", "recent"] as const).find((s) => s === values.tri) ?? "echeance";

  const db = getDb();
  const [todos, users, objs, tags] = await Promise.all([
    listTodos(db, filters, sort),
    listUsers(db),
    listObjects(db),
    listAllTags(db),
  ]);
  const totals = computeTotals(todos);
  const filterParams = Object.entries(values).filter(([, v]) => v) as [string, string][];
  const urlFor = (extra: Record<string, string>) => {
    const qs = new URLSearchParams([...filterParams, ...Object.entries(extra)]).toString();
    return `/taches${qs ? `?${qs}` : ""}`;
  };
  const here = urlFor(keep);

  let lanes: KanbanLane[] = [];
  if (board) {
    const cards = todos.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      objectId: t.objectId,
      objectName: t.objectName,
      assigneeName: t.assigneeName,
      estHours: t.estHours,
      recurring: t.recurrence !== "aucune",
      coverPhotoId: t.coverPhotoId,
    }));
    lanes = byRoot
      ? groupByRoot(objs, cards).map((l) => ({ id: l.root.id, name: l.root.name, cards: l.items }))
      : [{ id: "toutes", name: "Toutes les tâches", cards }];
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold">Toutes les tâches</h1>
        <p className="num text-muted">
          {todos.length} tâche{todos.length > 1 ? "s" : ""}
          {totals.open.openCount > 0 && ` · reste ${fmtHours(totals.open.estHours)} pour ${fmtEur(totals.open.estValueEur)}`}
          {totals.done.count > 0 && ` · réalisé ${fmtHours(totals.done.actualHours)} pour ${fmtEur(totals.done.actualValueEur)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle
          label="Affichage"
          options={[
            { label: "Liste", href: urlFor({}), active: !board },
            { label: "Tableau", href: urlFor({ vue: "tableau", ...(byRoot ? { groupe: "racine" } : {}) }), active: board },
          ]}
        />
        {board && (
          <Toggle
            label="Regrouper"
            options={[
              { label: "Sans regroupement", href: urlFor({ vue: "tableau" }), active: !byRoot },
              { label: "Par objet racine", href: urlFor({ vue: "tableau", groupe: "racine" }), active: byRoot },
            ]}
          />
        )}
      </div>
      <FilterBar
        keep={keep}
        hideStatus={board}
        values={values}
        users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
        objects={objectOptions(objs)}
        tags={tags}
        meId={me.id}
      />
      {todos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-5 text-muted">Aucune tâche ne correspond à ces filtres.</p>
      ) : board ? (
        <KanbanBoard lanes={lanes} grouped={byRoot} returnTo={here} />
      ) : (
        <ul className="rounded-xl bg-surface px-4">
          {todos.map((t) => (
            <TodoRow key={t.id} todo={t} returnTo={here} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex rounded-lg bg-surface p-0.5" role="group" aria-label={label}>
        {options.map((o) => (
          <Link
            key={o.label}
            href={o.href}
            aria-current={o.active ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 font-bold ${o.active ? "bg-moss-soft text-moss" : "text-muted hover:text-ink"}`}
          >
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
