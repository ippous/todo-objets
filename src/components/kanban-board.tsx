"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { setStatusInlineAction } from "@/app/actions";
import { dueState, fmtDate, fmtHours, STATUS_LABEL } from "@/lib/format";
import { Thumb } from "./thumb";

type Status = keyof typeof STATUS_LABEL;
const COLUMNS: Status[] = ["a_faire", "en_cours", "fait"];

export type KanbanCard = {
  id: string;
  title: string;
  status: Status;
  priority: "haute" | "moyenne" | "basse";
  dueDate: string | null;
  objectId: string;
  objectName: string;
  assigneeName: string | null;
  estHours: number | null;
  recurring: boolean;
  coverPhotoId: string | null;
};

export type KanbanLane = { id: string; name: string; cards: KanbanCard[] };

/**
 * Tableau des tâches : une colonne par statut, et éventuellement un couloir par objet racine.
 * On change le statut en glissant une carte (souris) ou avec les flèches de la carte (tactile, clavier).
 */
export function KanbanBoard({ lanes, grouped, returnTo }: { lanes: KanbanLane[]; grouped: boolean; returnTo: string }) {
  // Statuts déplacés, affichés tout de suite en attendant la réponse du serveur
  const [moved, setMoved] = useOptimistic<Record<string, Status>, [string, Status]>({}, (m, [id, s]) => ({ ...m, [id]: s }));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const statusOf = (c: KanbanCard) => moved[c.id] ?? c.status;
  const cards = lanes.flatMap((l) => l.cards);

  const moveTo = (id: string, status: Status) => {
    setDragging(null);
    setDropTarget(null);
    const card = cards.find((c) => c.id === id);
    if (!card || statusOf(card) === status) return;
    start(async () => {
      setMoved([id, status]);
      const r = await setStatusInlineAction(id, status);
      if (r.error) {
        setMessage({ kind: "error", text: r.error });
      } else {
        setMessage({
          kind: "ok",
          text: `« ${card.title} » est passée à « ${STATUS_LABEL[status]} »${
            status === "fait" && card.recurring ? ", la prochaine occurrence est créée" : ""
          }.`,
        });
      }
    });
  };

  return (
    <div className="grid gap-3">
      <p role="status" aria-live="polite" className={message ? "" : "sr-only"}>
        {message && (
          <span
            className={`block rounded-lg px-3 py-2 text-sm ${
              message.kind === "error" ? "bg-brick-soft text-brick" : "bg-moss-soft text-moss"
            }`}
          >
            {message.text}
          </span>
        )}
      </p>

      <div className={`-mx-4 overflow-x-auto px-4 pb-2 ${pending ? "opacity-80" : ""}`} aria-busy={pending}>
        <div className="grid min-w-[46rem] grid-cols-3 gap-3">
          {COLUMNS.map((s) => (
            <h2 key={s} className="flex items-baseline justify-between px-1 font-bold">
              {STATUS_LABEL[s]}
              <span className="num text-sm font-normal text-muted">{cards.filter((c) => statusOf(c) === s).length}</span>
            </h2>
          ))}

          {lanes.map((lane) => (
            <section key={lane.id} className="contents" aria-label={lane.name}>
              {grouped && (
                <h3 className="col-span-3 mt-2 flex items-baseline gap-2 border-b border-line pb-1">
                  <Link href={`/objets/${lane.id}`} className="font-bold text-moss underline-offset-4 hover:underline">
                    {lane.name}
                  </Link>
                  <span className="num text-sm text-muted">
                    {lane.cards.length} tâche{lane.cards.length > 1 ? "s" : ""}
                  </span>
                </h3>
              )}
              {COLUMNS.map((s) => {
                const key = `${lane.id}:${s}`;
                const inCell = lane.cards.filter((c) => statusOf(c) === s);
                return (
                  <ul
                    key={key}
                    data-testid={`colonne-${s}`}
                    aria-label={STATUS_LABEL[s]}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropTarget(key);
                    }}
                    onDragLeave={() => {
                      if (dropTarget === key) setDropTarget(null);
                    }}
                    onDrop={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      moveTo(dragging, s);
                    }}
                    className={`grid min-h-24 content-start gap-2 rounded-xl p-2 ${
                      dropTarget === key ? "bg-moss-soft outline-2 outline-moss" : "bg-surface"
                    }`}
                  >
                    {inCell.map((c) => (
                      <Card
                        key={c.id}
                        card={c}
                        status={s}
                        showObject={!grouped || c.objectId !== lane.id}
                        returnTo={returnTo}
                        dragging={dragging === c.id}
                        onDragStart={() => setDragging(c.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onMove={(to) => moveTo(c.id, to)}
                      />
                    ))}
                  </ul>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({
  card,
  status,
  showObject,
  returnTo,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: KanbanCard;
  status: Status;
  showObject: boolean;
  returnTo: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: Status) => void;
}) {
  const done = status === "fait";
  const due = dueState(card.dueDate, status);
  const i = COLUMNS.indexOf(status);
  const prev = COLUMNS[i - 1];
  const next = COLUMNS[i + 1];

  return (
    <li
      draggable
      data-testid="carte"
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`grid cursor-grab gap-1 rounded-lg border border-line bg-paper p-2.5 active:cursor-grabbing ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex gap-2">
        <Thumb photoId={card.coverPhotoId} size={36} />
        <div className="min-w-0">
          {card.priority === "haute" && !done && (
            <span className="mr-1.5 rounded bg-brick-soft px-1.5 text-xs font-bold text-brick">Priorité haute</span>
          )}
          <Link
            href={`/taches/${card.id}?retour=${encodeURIComponent(returnTo)}`}
            draggable={false}
            className={`font-bold break-words underline-offset-4 hover:underline ${done ? "text-muted line-through" : ""}`}
          >
            {card.title}
          </Link>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-sm text-muted">
        {showObject && <span className="text-moss">{card.objectName}</span>}
        {card.assigneeName && <span>Pour {card.assigneeName}</span>}
        {card.estHours != null && !done && <span className="num">{fmtHours(card.estHours)}</span>}
        {card.dueDate && (
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
            {fmtDate(card.dueDate)}
          </span>
        )}
        {card.recurring && <span>Récurrente</span>}
      </p>
      <div className="flex justify-between">
        {prev ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm font-bold text-moss hover:bg-moss-soft"
            onClick={() => onMove(prev)}
            aria-label={`Passer « ${card.title} » à « ${STATUS_LABEL[prev]} »`}
          >
            ← {STATUS_LABEL[prev]}
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm font-bold text-moss hover:bg-moss-soft"
            onClick={() => onMove(next)}
            aria-label={`Passer « ${card.title} » à « ${STATUS_LABEL[next]} »`}
          >
            {STATUS_LABEL[next]} →
          </button>
        )}
      </div>
    </li>
  );
}
