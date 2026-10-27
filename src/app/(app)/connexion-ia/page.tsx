import type { Metadata } from "next";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { listAccess } from "@/lib/oauth";
import { requireUser } from "@/lib/session";
import { CopyButton, CreateToken, RevokeButton } from "./token-panel";

export const metadata: Metadata = { title: "Connexion IA" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

function Snippet({ title, code, children }: { title: string; code: string; children?: React.ReactNode }) {
  return (
    <details className="rounded-xl bg-surface p-4">
      <summary className="cursor-pointer font-bold">{title}</summary>
      <div className="mt-3 grid gap-2 text-sm">
        {children}
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-paper p-3 text-xs">{code}</pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={code} />
          </div>
        </div>
      </div>
    </details>
  );
}

export default async function ConnexionIaPage() {
  const user = await requireUser();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const mcpUrl = `${origin}/api/mcp`;
  const access = await listAccess(getDb(), user.id);
  const tokens = access.filter((a) => a.kind === "personnel");
  const apps = access.filter((a) => a.kind === "application");

  return (
    <div className="grid max-w-3xl gap-8">
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold">Connexion IA (MCP)</h1>
        <p className="text-muted">
          Les assistants compatibles MCP (Claude, ChatGPT, Cursor, Copilot…) peuvent <strong>lire</strong> tes objets et tes
          tâches : arbre, détails, descriptions, documents, liens, recherche de tâches. Aucune modification n&apos;est
          possible par ce biais.
        </p>
      </div>

      <section aria-labelledby="adresse" className="grid gap-2">
        <h2 id="adresse" className="text-lg font-bold">
          Adresse du serveur MCP
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <code data-testid="mcp-url" className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2">
            {mcpUrl}
          </code>
          <CopyButton text={mcpUrl} />
        </div>
        <p className="text-sm text-muted">Transport « Streamable HTTP ». Deux façons de s&apos;authentifier, selon l&apos;assistant :</p>
      </section>

      <section aria-labelledby="oauth" className="grid gap-3">
        <h2 id="oauth" className="text-lg font-bold">
          1. Connecteur avec connexion (OAuth) — recommandé
        </h2>
        <p className="text-sm">
          Pour claude.ai (web, mobile, Desktop), ChatGPT et les assistants qui proposent d&apos;« ajouter un connecteur » :
          colle l&apos;adresse ci-dessus. L&apos;assistant ouvre une page Carnet ; tu te connectes avec Google et tu cliques sur
          <strong> Autoriser</strong>. Aucun jeton à copier.
        </p>
        <Snippet title="claude.ai / Claude Desktop" code={mcpUrl}>
          <p>Paramètres → Connecteurs → <em>Ajouter un connecteur personnalisé</em> → nom « Carnet », adresse ci-dessous → Ajouter, puis Se connecter.</p>
        </Snippet>
        <Snippet title="ChatGPT" code={mcpUrl}>
          <p>Paramètres → Applications et connecteurs → Créer (mode développeur si demandé) → adresse ci-dessous, authentification OAuth.</p>
        </Snippet>

        <h3 className="font-bold">Applications autorisées</h3>
        {apps.length === 0 ? (
          <p className="text-sm text-muted">Aucune application autorisée pour l&apos;instant.</p>
        ) : (
          <ul className="rounded-xl bg-surface px-4">
            {apps.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{a.name}</p>
                  <p className="text-sm text-muted">
                    Autorisée le {dt.format(a.createdAt)}
                    {a.lastUsedAt ? ` · dernière utilisation ${dt.format(a.lastUsedAt)}` : ""}
                  </p>
                </div>
                <RevokeButton id={a.id} label={a.name} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="jetons" className="grid gap-3">
        <h2 id="jetons" className="text-lg font-bold">
          2. Jeton personnel
        </h2>
        <p className="text-sm">
          Pour les outils qui se configurent avec une clé (Claude Code, Cursor, VS Code, Windsurf, scripts…). Le jeton est
          envoyé dans l&apos;en-tête <code>Authorization: Bearer …</code>. Traite-le comme un mot de passe.
        </p>
        <CreateToken />
        {tokens.length > 0 && (
          <ul className="rounded-xl bg-surface px-4">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{t.name}</p>
                  <p className="text-sm text-muted">
                    <code>{t.prefix}…</code> · créé le {dt.format(t.createdAt)}
                    {t.lastUsedAt ? ` · dernière utilisation ${dt.format(t.lastUsedAt)}` : " · jamais utilisé"}
                  </p>
                </div>
                <RevokeButton id={t.id} label={t.name} />
              </li>
            ))}
          </ul>
        )}

        <Snippet
          title="Claude Code"
          code={`claude mcp add --transport http carnet ${mcpUrl} --header "Authorization: Bearer VOTRE_JETON"`}
        />
        <Snippet
          title="Cursor / Windsurf (mcp.json)"
          code={JSON.stringify({ mcpServers: { carnet: { url: mcpUrl, headers: { Authorization: "Bearer VOTRE_JETON" } } } }, null, 2)}
        />
        <Snippet
          title="VS Code (Copilot, .vscode/mcp.json)"
          code={JSON.stringify({ servers: { carnet: { type: "http", url: mcpUrl, headers: { Authorization: "Bearer VOTRE_JETON" } } } }, null, 2)}
        />
        <Snippet
          title="Claude Desktop (claude_desktop_config.json, via mcp-remote)"
          code={JSON.stringify(
            {
              mcpServers: {
                carnet: {
                  command: "npx",
                  args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${AUTH_HEADER}"],
                  env: { AUTH_HEADER: "Bearer VOTRE_JETON" },
                },
              },
            },
            null,
            2,
          )}
        >
          <p>Ou plus simplement : le connecteur OAuth ci-dessus.</p>
        </Snippet>
      </section>
    </div>
  );
}
