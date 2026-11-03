import type { Metadata } from "next";
import Link from "next/link";
import { createCommandAction } from "@/app/command-actions";
import { getDb } from "@/db";
import { getAiChoice } from "@/lib/ai";
import { requireAdmin } from "@/lib/session";
import { CommandEditor } from "../command-editor";

export const metadata: Metadata = { title: "Nouvelle commande" };

export default async function NouvelleCommandePage() {
  await requireAdmin();
  const ai = await getAiChoice(getDb());
  return (
    <div className="grid gap-4">
      <Link href="/commandes" className="text-sm text-moss underline-offset-4 hover:underline">
        ← Commandes
      </Link>
      <h1 className="text-2xl font-bold">Nouvelle commande</h1>
      <CommandEditor action={createCommandAction} readOnly={false} ai={ai} submitLabel="Créer la commande" />
    </div>
  );
}
