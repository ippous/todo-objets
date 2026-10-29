import Link from "next/link";
import type { AuditEntry } from "@/db/schema";
import { ACTION_LABEL, describeDetails, SOURCE_LABEL } from "@/lib/audit";

const when = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

/**
 * Liste des entrées du journal. `showEntity` : affiche l'objet ou la tâche concernés
 * ("taches" pour ne montrer que les tâches, sur la fiche d'un objet).
 */
export function AuditTrail({ entries, showEntity = "all" }: { entries: AuditEntry[]; showEntity?: "all" | "taches" | "none" }) {
  if (entries.length === 0) return <p className="text-muted">Aucune action enregistrée.</p>;
  return (
    <ol className="grid gap-0">
      {entries.map((e) => {
        const lines = describeDetails(e);
        const entity = showEntity === "all" || (showEntity === "taches" && e.entityKind === "tache");
        const href = e.action === "suppression" ? null : e.entityKind === "tache" ? `/taches/${e.entityId}` : `/objets/${e.entityId}`;
        return (
          <li key={e.id} className="grid gap-0.5 border-b border-line py-2 last:border-b-0">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-bold">{ACTION_LABEL[e.action] ?? e.action}</span>
              {entity && (
                <span>
                  {e.entityKind === "tache" ? "tâche " : "objet "}
                  {href ? (
                    <Link href={href} className="text-moss underline-offset-4 hover:underline">
                      {e.entityLabel}
                    </Link>
                  ) : (
                    e.entityLabel
                  )}
                </span>
              )}
            </p>
            {lines.length > 0 && (
              <ul className="text-sm">
                {lines.map((l, i) => (
                  <li key={i} className="break-words">
                    {l}
                  </li>
                ))}
              </ul>
            )}
            <p className="flex flex-wrap gap-x-2 text-sm text-muted">
              <time dateTime={e.at.toISOString()}>{when.format(e.at)}</time>
              <span>· {e.userName}</span>
              <span className="rounded bg-moss-soft px-1.5 text-xs font-bold text-moss" title={e.client ?? undefined}>
                {SOURCE_LABEL[e.source]}
                {e.client ? ` · ${e.client}` : ""}
              </span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
