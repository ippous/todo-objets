import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { devLoginEnabled, googleEnabled } from "@/auth";
import { signInWithGoogle } from "@/app/actions";
import { getCurrentUser } from "@/lib/session";
import { DevLoginForm } from "./dev-login-form";

export const metadata: Metadata = { title: "Connexion" };

const ERRORS: Record<string, string> = {
  AccessDenied: "Cette adresse n'est pas autorisée. Demande à un administrateur de l'ajouter.",
  Configuration: "La connexion n'est pas configurée sur cet environnement.",
};

export default async function ConnexionPage(props: PageProps<"/connexion">) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await props.searchParams;
  const message = typeof error === "string" ? (ERRORS[error] ?? "La connexion a échoué. Réessaie.") : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-12">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={44} height={44} />
        <div>
          <h1 className="text-2xl font-bold">Carnet</h1>
          <p className="text-muted">Les tâches de chaque chose, à sa place dans l&apos;arbre.</p>
        </div>
      </div>

      {message && (
        <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
          {message}
        </p>
      )}

      {googleEnabled && (
        <form action={signInWithGoogle}>
          <button type="submit" className="btn btn-primary w-full">
            Se connecter avec Google
          </button>
        </form>
      )}

      {devLoginEnabled && <DevLoginForm />}

      {!googleEnabled && !devLoginEnabled && (
        <p className="text-sm text-muted">Aucune méthode de connexion n&apos;est configurée sur cet environnement.</p>
      )}
    </main>
  );
}
