import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { emailConfigured, pushConfigured, vapidPublicKey } from "@/lib/notify";
import { listPushSubscriptions, listReminderSchemes } from "@/lib/reminder-repo";
import { formatOffsets } from "@/lib/reminders";
import { requireUser } from "@/lib/session";
import { NotifyPrefs } from "./notify-prefs";

export const metadata: Metadata = { title: "Mes rappels" };

export default async function MesRappelsPage() {
  const user = await requireUser();
  const db = getDb();
  const [subs, schemes] = await Promise.all([listPushSubscriptions(db, user.id), listReminderSchemes(db)]);
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });
  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <h1 className="text-2xl font-bold">Mes rappels</h1>
        <p className="max-w-prose text-muted">
          Une tâche avec une échéance et un schéma de rappel prévient son <strong>responsable</strong> (ou, sans responsable, la
          personne qui l&apos;a créée), sur les canaux choisis ici.
        </p>
      </div>
      <NotifyPrefs
        email={user.email}
        notifyEmail={user.notifyEmail}
        notifyPush={user.notifyPush}
        emailReady={emailConfigured()}
        pushKey={pushConfigured() ? vapidPublicKey() : null}
        devices={subs.map((s) => ({
          id: s.id,
          endpoint: s.endpoint,
          label: s.label,
          since: fmt.format(s.createdAt),
          lastSuccess: s.lastSuccessAt ? fmt.format(s.lastSuccessAt) : null,
        }))}
      />
      <section aria-labelledby="schemas" className="grid gap-2">
        <h2 id="schemas" className="text-lg font-bold">
          Schémas disponibles
        </h2>
        <ul className="rounded-xl bg-surface px-4">
          {schemes.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-x-3 border-b border-line py-2 last:border-b-0">
              <span className="font-bold">{s.name}</span>
              <span className="num text-muted">{formatOffsets(s.offsets)}</span>
              {s.isDefault && <span className="text-sm text-ochre">par défaut</span>}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Le schéma se choisit sur chaque tâche, sous l&apos;échéance.
          {user.role === "admin" && (
            <>
              {" "}
              <Link href="/utilisateurs/rappels" className="text-moss underline-offset-4 hover:underline">
                Gérer les schémas
              </Link>
            </>
          )}
        </p>
      </section>
    </div>
  );
}
