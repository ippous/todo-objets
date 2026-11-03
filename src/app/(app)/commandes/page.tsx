import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { listCommands } from "@/lib/commands";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Commandes" };

export default async function CommandesPage() {
  const me = await requireUser();
  const list = await listCommands(getDb());
  const isAdmin = me.role === "admin";
  return (
    <div className="grid max-w-3xl gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold">Commandes de saisie</h1>
        <p className="max-w-prose text-muted">
          Dans une description, tape <b className="text-ink">$$nom</b> pour insérer le résultat d&apos;une commande (il reste
          tel quel), ou <b className="text-ink">@@nom</b> pour qu&apos;il soit recalculé à chaque affichage. Chaque commande est
          un petit programme JavaScript{isAdmin ? "" : ", écrit par un administrateur"}.
        </p>
        {isAdmin && (
          <Link href="/commandes/nouvelle" className="btn btn-primary w-fit">
            Nouvelle commande
          </Link>
        )}
      </div>
      <ul className="rounded-xl bg-surface px-4">
        {list.map((c) => (
          <li key={c.id} className="border-b border-line py-3 last:border-b-0">
            <Link href={`/commandes/${c.id}`} className="font-bold text-moss underline-offset-4 hover:underline">
              {c.name}
            </Link>
            <span className="ml-2 text-sm text-muted">
              $${c.name} · @@{c.name}
            </span>
            {c.description && <p className="text-sm text-muted">{c.description}</p>}
          </li>
        ))}
        {list.length === 0 && <li className="py-3 text-muted">Aucune commande pour l&apos;instant.</li>}
      </ul>
    </div>
  );
}
