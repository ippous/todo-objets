import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { AI_DEFAULT_MODEL, AI_MODEL_SUGGESTIONS, AI_PROVIDER_LABEL, AI_PROVIDERS, getAiSettings } from "@/lib/ai";
import { requireAdmin } from "@/lib/session";
import { ProviderForm } from "./provider-form";

export const metadata: Metadata = { title: "Assistants IA" };

export default async function AssistantsIaPage() {
  await requireAdmin();
  const settings = await getAiSettings(getDb());
  return (
    <div className="grid max-w-2xl gap-8">
      <div>
        <Link href="/utilisateurs" className="text-sm text-moss underline-offset-4 hover:underline">
          ← Accès
        </Link>
        <h1 className="text-2xl font-bold">Assistants IA</h1>
        <p className="max-w-prose text-muted">
          Les boutons « Compléter la description » et « Proposer des sous-tâches » d&apos;une tâche utilisent l&apos;un de ces
          fournisseurs. Les clés d&apos;API sont chiffrées en base et ne sont plus jamais affichées ; seuls leurs 4 derniers
          caractères restent visibles. L&apos;usage est facturé par le fournisseur sur ton compte.
        </p>
      </div>
      {AI_PROVIDERS.map((p) => (
        <ProviderForm
          key={p}
          provider={p}
          label={AI_PROVIDER_LABEL[p]}
          model={settings.providers[p].model}
          defaultModel={AI_DEFAULT_MODEL[p]}
          suggestions={AI_MODEL_SUGGESTIONS[p]}
          configured={settings.providers[p].configured}
          keyHint={settings.providers[p].keyHint}
          isDefault={settings.defaultProvider === p}
          consoleUrl={p === "anthropic" ? "https://console.anthropic.com/settings/keys" : "https://platform.openai.com/api-keys"}
        />
      ))}
    </div>
  );
}
