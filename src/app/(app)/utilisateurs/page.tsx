import type { Metadata } from "next";
import { getDb } from "@/db";
import { listUsers } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import { AddUserForm, EditUserForm } from "./forms";

export const metadata: Metadata = { title: "Accès" };

export default async function UtilisateursPage() {
  const me = await requireAdmin();
  const users = await listUsers(getDb());
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-2xl font-bold">Qui a accès</h1>
        <p className="max-w-prose text-muted">
          Seules les adresses listées ici peuvent se connecter. Le temps disponible par semaine servira au planning.
        </p>
      </div>
      <ul className="grid gap-3">
        {users.map((u) => (
          <li key={u.id} className="rounded-xl bg-surface p-4">
            <EditUserForm
              user={{
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                weeklyHoursAvailable: u.weeklyHoursAvailable,
                skills: u.skills,
                active: u.active,
              }}
              isMe={u.id === me.id}
            />
          </li>
        ))}
      </ul>
      <section className="grid max-w-xl gap-3">
        <h2 className="text-lg font-bold">Autoriser une nouvelle personne</h2>
        <AddUserForm />
      </section>
    </div>
  );
}
