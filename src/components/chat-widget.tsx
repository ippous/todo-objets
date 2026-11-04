"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Maximize2, MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./chat-panel";

const OPEN_KEY = "carnet-chat-ouvert";

/**
 * Assistant ouvrable depuis toutes les pages : bulle en bas à droite, puis fenêtre flottante
 * (plein écran sur téléphone). La conversation suit d'une page à l'autre.
 */
export function ChatWidget({
  providers,
  defaultProvider,
  userId,
  isAdmin,
}: {
  providers: { id: string; label: string }[];
  defaultProvider: string | null;
  userId: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- état mémorisé, lu après le premier rendu
      if (sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {}
  }, []);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      sessionStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {}
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && toggle(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // La page Assistant affiche déjà le chat en grand
  if (pathname === "/assistant") return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Ouvrir l'assistant"
          title="Assistant"
          className="fixed right-4 bottom-20 z-40 grid size-12 place-items-center rounded-full bg-moss text-surface shadow-lg hover:brightness-110 sm:right-6 sm:bottom-6"
        >
          <MessageCircle size={24} aria-hidden />
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Assistant"
          className="fixed inset-0 z-50 flex flex-col bg-paper sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(660px,calc(100dvh-3rem))] sm:w-[420px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <MessageCircle size={20} aria-hidden className="text-moss" />
            <h2 className="flex-1 font-bold">Assistant</h2>
            <Link
              href="/assistant"
              onClick={() => toggle(false)}
              className="grid size-9 place-items-center rounded-md text-muted hover:bg-moss-soft hover:text-ink"
              aria-label="Ouvrir en plein écran"
              title="Plein écran"
            >
              <Maximize2 size={18} aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => toggle(false)}
              className="grid size-9 place-items-center rounded-md text-muted hover:bg-moss-soft hover:text-ink"
              aria-label="Fermer l'assistant"
              title="Fermer (Échap)"
            >
              <X size={20} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
            {providers.length && defaultProvider ? (
              <ChatPanel providers={providers} defaultProvider={defaultProvider} userId={userId} compact />
            ) : (
              <p className="p-4 text-muted">
                Aucun assistant IA n&apos;est configuré.{" "}
                {isAdmin ? (
                  <Link href="/utilisateurs/ia" onClick={() => toggle(false)} className="text-moss underline underline-offset-4">
                    Ajouter une clé d&apos;API
                  </Link>
                ) : (
                  "Un administrateur peut ajouter une clé d'API dans Accès › Assistants IA."
                )}
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}
