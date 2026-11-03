import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { listTypes } from "@/lib/repo";
import { TypeManager } from "./type-manager";

export const metadata: Metadata = { title: "Types" };

export default async function TypesPage() {
  const db = getDb();
  const [objectTypes, docTypes, taskTypes] = await Promise.all([
    listTypes(db, "objet"),
    listTypes(db, "document"),
    listTypes(db, "tache"),
  ]);
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-2xl font-bold">Types</h1>
        <p className="max-w-prose text-muted">
          Les types classent les objets (bâtiment, véhicule…), les tâches (entretien, travaux…) et les documents (facture,
          garantie…). Une tâche sans photo affiche l&apos;icône de son type. Un type ne peut être
          supprimé que s&apos;il n&apos;est plus utilisé ; renommer un type met à jour tout ce qui l&apos;utilise.
        </p>
        <p className="mt-2">
          <Link href="/commandes" className="text-moss underline-offset-4 hover:underline">
            Commandes de saisie ($$ et @@) →
          </Link>
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <TypeManager kind="objet" title="Types d'objets" types={objectTypes} unit={["objet", "objets"]} />
        <TypeManager kind="tache" title="Types de tâches" types={taskTypes} unit={["tâche", "tâches"]} />
        <TypeManager kind="document" title="Types de documents" types={docTypes} unit={["document", "documents"]} />
      </div>
    </div>
  );
}
