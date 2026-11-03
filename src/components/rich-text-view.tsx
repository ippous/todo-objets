"use client";

import { useEffect, useRef } from "react";
import { fillLiveCommands, type CommandContext } from "@/lib/command-runtime";

/** Description en lecture seule ; les commandes @@ y sont calculées à l'affichage. */
export function RichTextView({ html, context, className = "" }: { html: string; context?: CommandContext; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titre = context?.titre ?? null;
  const objet = context?.objet ?? null;
  useEffect(() => {
    if (ref.current) fillLiveCommands(ref.current, { titre, objet });
  }, [html, titre, objet]);
  // HTML déjà nettoyé côté serveur
  return <div ref={ref} className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
