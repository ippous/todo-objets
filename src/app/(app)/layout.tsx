import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { NavLinks } from "@/components/nav-links";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col">
      <header className="flex items-center gap-4 px-4 pt-4 pb-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} />
          Carnet
        </Link>
        <nav aria-label="Navigation principale" className="hidden flex-1 sm:block">
          <NavLinks isAdmin={user.role === "admin"} variant="top" />
        </nav>
        <Link href="/connexion-ia" className="ml-auto whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline sm:ml-0" aria-label="Connexion IA">
          <span className="sm:hidden">IA</span>
          <span className="hidden sm:inline">Connexion IA</span>
        </Link>
        <form action={signOutAction}>
          <button className="whitespace-nowrap text-sm text-muted underline-offset-4 hover:underline" type="submit">
            <span className="hidden sm:inline">{user.name} · </span>Se déconnecter
          </button>
        </form>
      </header>
      <main className="flex-1 px-4 pt-2 pb-28 sm:px-6 sm:pb-12">{children}</main>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <NavLinks isAdmin={user.role === "admin"} variant="bottom" />
      </nav>
    </div>
  );
}
