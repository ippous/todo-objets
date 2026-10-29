import type { Metadata } from "next";
import Link from "next/link";
import { AuditTrail } from "@/components/audit-trail";
import { getDb } from "@/db";
import type { AuditSource } from "@/db/schema";
import { listAudit, SOURCE_LABEL } from "@/lib/audit";
import { getObject, getTodo, listUsers } from "@/lib/repo";

export const metadata: Metadata = { title: "Journal" };

const UUID = /^[0-9a-f-]{36}$/i;
const PAGE = 100;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const SOURCES = Object.keys(SOURCE_LABEL) as AuditSource[];

export default async function JournalPage(props: PageProps<"/journal">) {
  const sp = await props.searchParams;
  const origine = SOURCES.find((s) => s === one(sp.origine));
  const auteur = UUID.test(one(sp.auteur)) ? one(sp.auteur) : undefined;
  const objet = UUID.test(one(sp.objet)) ? one(sp.objet) : undefined;
  const tache = UUID.test(one(sp.tache)) ? one(sp.tache) : undefined;
  const apres = UUID.test(one(sp.apres)) ? one(sp.apres) : undefined;

  const db = getDb();
  const [entries, users, obj, todo] = await Promise.all([
    listAudit(db, { source: origine, userId: auteur, objectId: objet, todoId: tache, afterId: apres, limit: PAGE }),
    listUsers(db),
    objet ? getObject(db, objet) : undefined,
    tache ? getTodo(db, tache) : undefined,
  ]);
  const keep = (extra: Record<string, string>) => {
    const qs = new URLSearchParams(
      Object.entries({ origine: origine ?? "", auteur: auteur ?? "", objet: objet ?? "", tache: tache ?? "", ...extra }).filter(([, v]) => v),
    ).toString();
    return `/journal${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Journal</h1>
        <p className="max-w-prose text-muted">
          Les actions faites sur les objets et les tâches, avec leur auteur, leur date et leur origine : l&apos;interface de
          Carnet, l&apos;API ou un assistant IA (MCP, extension Chrome).
        </p>
        {(obj || todo) && (
          <p className="mt-2">
            Filtré sur {obj ? `l'objet « ${obj.name} » et ses tâches` : `la tâche « ${todo!.title} »`} ·{" "}
            <Link href={keep({ objet: "", tache: "" })} className="text-moss underline-offset-4 hover:underline">
              tout afficher
            </Link>
          </p>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-surface p-4">
        {objet && <input type="hidden" name="objet" value={objet} />}
        {tache && <input type="hidden" name="tache" value={tache} />}
        <label className="field">
          <span>Origine</span>
          <select className="input" name="origine" defaultValue={origine ?? ""}>
            <option value="">Toutes</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Auteur</span>
          <select className="input" name="auteur" defaultValue={auteur ?? ""}>
            <option value="">Tous</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-ghost">
          Filtrer
        </button>
      </form>

      <section aria-label="Actions" className="rounded-xl bg-surface px-4 py-2">
        <AuditTrail entries={entries} />
      </section>

      {entries.length === PAGE && (
        <Link href={keep({ apres: entries[entries.length - 1].id })} className="btn btn-ghost justify-self-start">
          Actions plus anciennes
        </Link>
      )}
    </div>
  );
}
