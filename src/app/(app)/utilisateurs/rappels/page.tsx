import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { listReminderSchemes } from "@/lib/reminder-repo";
import { formatOffsets } from "@/lib/reminders";
import { requireAdmin } from "@/lib/session";
import { SchemeManager } from "./scheme-manager";

export const metadata: Metadata = { title: "Schémas de rappel" };

export default async function SchemasRappelPage() {
  await requireAdmin();
  const schemes = await listReminderSchemes(getDb());
  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <Link href="/utilisateurs" className="text-sm text-moss underline-offset-4 hover:underline">
          ← Accès
        </Link>
        <h1 className="text-2xl font-bold">Schémas de rappel</h1>
        <p className="max-w-prose text-muted">
          Chaque tâche avec une échéance peut suivre l&apos;un de ces schémas. <strong>J-n</strong> : n jours avant,{" "}
          <strong>H-n</strong> : n heures avant, <strong>M-n</strong> : n minutes avant. Sans heure d&apos;échéance, les rappels J
          partent à 8 h et les rappels H et M ne s&apos;appliquent pas.
        </p>
      </div>
      <SchemeManager
        schemes={schemes.map((s) => ({ id: s.id, name: s.name, offsets: formatOffsets(s.offsets), isDefault: s.isDefault, usage: s.usage }))}
      />
    </div>
  );
}
