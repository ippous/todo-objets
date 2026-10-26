import type { Metadata } from "next";
import { FilterBar, type FilterValues } from "@/components/filter-bar";
import { TodoRow } from "@/components/todo-row";
import { getDb } from "@/db";
import { CATEGORIES, PRIORITIES, type Todo } from "@/db/schema";
import { fmtEur, fmtHours } from "@/lib/format";
import { objectOptions } from "@/lib/options";
import { computeTotals, listAllTags, listObjects, listTodos, listUsers, type TodoFilters, type TodoSort } from "@/lib/repo";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Tâches" };

const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function TachesPage(props: PageProps<"/taches">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const values: FilterValues = {
    statut: one(sp.statut),
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
      values.statut === "toutes"
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
  const qs = new URLSearchParams(Object.entries(values).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/taches${qs ? `?${qs}` : ""}`;

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
      <FilterBar
        values={values}
        users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
        objects={objectOptions(objs)}
        tags={tags}
        meId={me.id}
      />
      {todos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-5 text-muted">Aucune tâche ne correspond à ces filtres.</p>
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
