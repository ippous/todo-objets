import Link from "next/link";
import { CATEGORY_LABEL, dueState, fmtDate, fmtEur, fmtHours, PRIORITY_LABEL } from "@/lib/format";
import type { TodoListItem } from "@/lib/repo";
import { QuickStatus } from "./quick-status";

export function TodoRow({ todo, returnTo, showObject = true }: { todo: TodoListItem; returnTo: string; showObject?: boolean }) {
  const due = dueState(todo.dueDate, todo.status);
  const done = todo.status === "fait";
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {todo.priority === "haute" && !done && (
            <span className="shrink-0 rounded bg-brick-soft px-1.5 text-xs font-bold text-brick">Priorité haute</span>
          )}
          <Link
            href={`/taches/${todo.id}?retour=${encodeURIComponent(returnTo)}`}
            className={`font-bold underline-offset-4 hover:underline ${done ? "text-muted line-through" : ""}`}
          >
            {todo.title}
          </Link>
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted">
          {showObject && (
            <Link href={`/objets/${todo.objectId}`} className="text-moss underline-offset-4 hover:underline">
              {todo.objectName}
            </Link>
          )}
          <span>{CATEGORY_LABEL[todo.category]}</span>
          {todo.priority !== "haute" && <span>Priorité {PRIORITY_LABEL[todo.priority].toLowerCase()}</span>}
          {todo.assigneeName && <span>Pour {todo.assigneeName}</span>}
          {todo.dueDate && (
            <span
              className={
                due === "retard"
                  ? "rounded bg-brick-soft px-1 font-bold text-brick"
                  : due === "proche"
                    ? "rounded bg-ochre-soft px-1 font-bold text-ochre"
                    : ""
              }
            >
              {due === "retard" ? "En retard · " : ""}
              {fmtDate(todo.dueDate)}
            </span>
          )}
          {todo.recurrence !== "aucune" && <span>Récurrente</span>}
          {todo.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
        <dl className="num flex gap-3 text-sm">
          {done ? (
            <>
              <div>
                <dt className="sr-only">Durée réalisée</dt>
                <dd>{fmtHours(todo.actualHours)}</dd>
              </div>
              <div>
                <dt className="sr-only">Valeur réalisée</dt>
                <dd>{fmtEur(todo.actualValueEur)}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt className="sr-only">Durée prévue</dt>
                <dd>{fmtHours(todo.estHours)}</dd>
              </div>
              <div>
                <dt className="sr-only">Valeur estimée</dt>
                <dd>{fmtEur(todo.estValueEur)}</dd>
              </div>
              {todo.valuePerHour != null && (
                <div>
                  <dt className="sr-only">Valeur par heure</dt>
                  <dd className="font-bold text-moss">{fmtEur(todo.valuePerHour)}/h</dd>
                </div>
              )}
            </>
          )}
        </dl>
        <QuickStatus
          id={todo.id}
          status={todo.status}
          estHours={todo.estHours}
          estValueEur={todo.estValueEur}
          recurring={todo.recurrence !== "aucune"}
        />
      </div>
    </li>
  );
}
