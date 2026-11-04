import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { NavLinks } from "@/components/nav-links";
import { requireUser } from "@/lib/session";
import { ChatWidget } from "@/components/chat-widget";
import { getDb } from "@/db";
import { AI_PROVIDER_LABEL, AI_PROVIDERS, getAiSettings } from "@/lib/ai";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const ai = await getAiSettings(getDb());
  const providers = AI_PROVIDERS.filter((p) => ai.providers[p].configured).map((p) => ({
    id: p,
    label: `${AI_PROVIDER_LABEL[p]} · ${ai.providers[p].model}`,
  }));
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header className="flex items-center gap-3 px-4 sm:gap-4 pt-4 pb-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          Carnet
        </Link>
        <nav aria-label="Navigation principale" className="hidden flex-1 sm:block">
          <NavLinks isAdmin={user.role === "admin"} variant="top" />
        </nav>
        <Link href="/journal" className="ml-auto whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline sm:ml-0">
          Journal
        </Link>
        <Link href="/rappels" className="whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline">
          Rappels
        </Link>
        <Link href="/connexion-ia" className="whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline" aria-label="Connexion IA">
          <span className="sm:hidden">IA</span>
          <span className="hidden sm:inline">Connexion IA</span>
        </Link>
        <form action={signOutAction}>
          <button className="whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline" type="submit">
            <span className="hidden sm:inline">{user.name} · </span>Se déconnecter
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 pt-2 pb-36 sm:px-6 sm:pb-24">{children}</main>
      <ChatWidget providers={providers} defaultProvider={ai.defaultProvider} userId={user.id} isAdmin={user.role === "admin"} />
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <NavLinks isAdmin={user.role === "admin"} variant="bottom" />
      </nav>
    </div>
  );
}
