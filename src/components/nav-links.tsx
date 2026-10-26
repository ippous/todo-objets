"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Arbre", match: (p: string) => p === "/" || p.startsWith("/objets") },
  { href: "/taches", label: "Tâches", match: (p: string) => p === "/taches" },
  { href: "/taches/nouvelle", label: "Ajouter", match: (p: string) => p === "/taches/nouvelle" },
  { href: "/types", label: "Types", match: (p: string) => p.startsWith("/types") },
];

export function NavLinks({ isAdmin, variant }: { isAdmin: boolean; variant: "top" | "bottom" }) {
  const pathname = usePathname();
  const links = isAdmin
    ? [...LINKS, { href: "/utilisateurs", label: "Accès", match: (p: string) => p.startsWith("/utilisateurs") }]
    : LINKS;

  if (variant === "bottom") {
    return (
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${links.length}, 1fr)` }}>
        {links.map((l) => {
          const active = l.match(pathname);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center text-sm font-bold ${
                  active ? "text-moss" : "text-muted"
                } ${l.href === "/taches/nouvelle" ? "text-moss" : ""}`}
              >
                {l.href === "/taches/nouvelle" ? (
                  <span className="rounded-full bg-moss px-4 py-1.5 text-surface">+ Ajouter</span>
                ) : (
                  l.label
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="flex items-center gap-1">
      {links.map((l) => {
        const active = l.match(pathname);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${
                active ? "bg-moss-soft text-moss" : "text-muted hover:text-ink"
              }`}
            >
              {l.href === "/taches/nouvelle" ? "+ Ajouter une tâche" : l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
