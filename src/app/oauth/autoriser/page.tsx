import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { OAuthError, requestsWrite, validateAuthorize } from "@/lib/oauth";
import { getCurrentUser } from "@/lib/session";
import { approveAction, denyAction } from "./actions";

export const metadata: Metadata = { title: "Autoriser une application" };

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={40} height={40} />
        <span className="text-xl font-bold">Carnet</span>
      </div>
      {children}
    </main>
  );
}

export default async function AutoriserPage(props: PageProps<"/oauth/autoriser">) {
  const sp = await props.searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  if (get("erreur")) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Autorisation impossible</h1>
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-brick">
          {get("erreur")}
        </p>
      </Shell>
    );
  }

  // Connexion d'abord (Google), puis retour ici avec les mêmes paramètres
  const user = await getCurrentUser();
  if (!user) {
    const qs = new URLSearchParams(FIELDS.flatMap((k) => (get(k) ? [[k, get(k)]] : []))).toString();
    redirect(`/connexion?retour=${encodeURIComponent(`/oauth/autoriser?${qs}`)}`);
  }

  let clientName: string;
  try {
    const client = await validateAuthorize(getDb(), {
      clientId: get("client_id"),
      redirectUri: get("redirect_uri"),
      codeChallenge: get("code_challenge"),
      codeChallengeMethod: get("code_challenge_method"),
      scope: get("scope"),
      resource: get("resource") || null,
      responseType: get("response_type"),
    });
    clientName = client.name;
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Demande invalide</h1>
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-brick">
          {err.description}
        </p>
      </Shell>
    );
  }
  const wantsWrite = requestsWrite(get("scope"));
  const redirectHost = (() => {
    try {
      const u = new URL(get("redirect_uri"));
      return u.host || u.protocol;
    } catch {
      return "";
    }
  })();

  const hidden = FIELDS.map((k) => <input key={k} type="hidden" name={k} value={get(k)} />);
  return (
    <Shell>
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold">Autoriser « {clientName} » ?</h1>
        <p className="text-muted">
          Connecté en tant que <strong className="text-ink">{user.name}</strong> ({user.email}).
        </p>
      </div>
      <div className="grid gap-2 rounded-xl bg-surface p-4">
        <p>Cette application pourra, via le serveur MCP de Carnet :</p>
        <ul className="list-disc pl-5">
          <li>lire l&apos;arbre des objets, leurs descriptions, documents et liens ;</li>
          <li>lire les tâches et leur détail.</li>
        </ul>
        <p className="text-sm text-muted">Retour vers : {redirectHost}</p>
      </div>
      <label className="flex gap-3 rounded-xl border-2 border-ochre bg-ochre-soft p-4">
        <input type="checkbox" name="ecriture" form="autoriser" defaultChecked={wantsWrite} className="mt-1 size-5 shrink-0" />
        <span className="grid gap-1">
          <span className="font-bold">Autoriser aussi les modifications</span>
          <span className="text-sm">
            Créer et modifier des tâches (statut, échéance, durée, valeur…), créer, modifier et déplacer des objets, ajouter
            des liens. Aucune suppression n&apos;est possible par ce biais. Sans cette case, l&apos;accès reste en lecture seule.
          </span>
        </span>
      </label>
      <p className="text-sm text-muted">Tu peux retirer cet accès à tout moment dans « Connexion IA ».</p>
      <div className="flex flex-wrap gap-2">
        <form id="autoriser" action={approveAction}>
          {hidden}
          <button type="submit" className="btn btn-primary">
            Autoriser
          </button>
        </form>
        <form action={denyAction}>
          {hidden}
          <button type="submit" className="btn btn-ghost">
            Refuser
          </button>
        </form>
      </div>
    </Shell>
  );
}
