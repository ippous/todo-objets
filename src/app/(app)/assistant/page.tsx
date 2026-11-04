import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { getAiSettings, AI_PROVIDER_LABEL, AI_PROVIDERS } from "@/lib/ai";
import { requireUser } from "@/lib/session";
import { ChatPanel } from "@/components/chat-panel";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const user = await requireUser();
  const settings = await getAiSettings(getDb());
  const providers = AI_PROVIDERS.filter((p) => settings.providers[p].configured).map((p) => ({
    id: p,
    label: `${AI_PROVIDER_LABEL[p]} · ${settings.providers[p].model}`,
  }));
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Assistant</h1>
        <p className="max-w-prose text-muted">
          Pose une question ou demande une modification : l&apos;assistant cherche et agit dans Carnet avec tes droits (mêmes outils que
          la connexion MCP). Ses actions apparaissent dans le journal, origine « MCP · Chat Carnet ».
        </p>
      </div>
      {providers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-5 text-muted">
          Aucun assistant IA n&apos;est configuré.{" "}
          {user.role === "admin" ? (
            <Link href="/utilisateurs/ia" className="text-moss underline-offset-4 hover:underline">
              Ajouter une clé d&apos;API Claude ou ChatGPT
            </Link>
          ) : (
            "Un administrateur peut ajouter une clé d'API dans Accès › Assistants IA."
          )}
        </p>
      ) : (
        <ChatPanel providers={providers} defaultProvider={settings.defaultProvider ?? providers[0].id} userId={user.id} />
      )}
    </div>
  );
}
