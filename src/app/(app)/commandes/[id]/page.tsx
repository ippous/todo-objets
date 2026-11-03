import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateCommandAction } from "@/app/command-actions";
import { getDb } from "@/db";
import { getAiChoice } from "@/lib/ai";
import { getCommand } from "@/lib/commands";
import { requireUser } from "@/lib/session";
import { CommandEditor } from "../command-editor";

export const metadata: Metadata = { title: "Commande" };

export default async function CommandePage(props: PageProps<"/commandes/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  const { enregistree } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [cmd, ai] = await Promise.all([getCommand(db, id), getAiChoice(db)]);
  if (!cmd) notFound();
  const isAdmin = me.role === "admin";
  return (
    <div className="grid gap-4">
      <Link href="/commandes" className="text-sm text-moss underline-offset-4 hover:underline">
        ← Commandes
      </Link>
      <h1 className="text-2xl font-bold">
        $${cmd.name} <span className="font-normal text-muted">·</span> @@{cmd.name}
      </h1>
      <CommandEditor
        key={cmd.updatedAt.toISOString()}
        action={isAdmin ? updateCommandAction.bind(null, id) : undefined}
        id={id}
        values={{ name: cmd.name, description: cmd.description, code: cmd.code }}
        readOnly={!isAdmin}
        ai={ai}
        saved={enregistree === "1"}
        submitLabel="Enregistrer"
      />
    </div>
  );
}
