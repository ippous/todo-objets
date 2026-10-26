"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "@/lib/format";
import type { ObjectOption } from "@/lib/options";

export type FilterValues = {
  statut: string;
  responsable: string;
  categorie: string;
  priorite: string;
  tag: string;
  objet: string;
  avant: string;
  q: string;
  tri: string;
};

export function FilterBar({
  values,
  users,
  objects,
  tags,
  meId,
}: {
  values: FilterValues;
  users: { id: string; name: string }[];
  objects: ObjectOption[];
  tags: string[];
  meId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const apply = () => {
    const fd = new FormData(formRef.current!);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "") params.set(k, v);
    router.replace(`/taches${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  return (
    <form
      ref={formRef}
      onChange={(e) => {
        if ((e.target as HTMLElement).getAttribute("name") !== "q") apply();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="grid gap-3 rounded-xl bg-surface p-4"
      role="search"
      aria-label="Filtrer les tâches"
    >
      <div className="flex gap-2">
        <label className="field flex-1">
          <span className="sr-only">Rechercher</span>
          <input className="input" type="search" name="q" placeholder="Rechercher dans les titres et descriptions" defaultValue={values.q} />
        </label>
        <button type="submit" className="btn btn-ghost">
          Chercher
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Select name="statut" label="Statut" value={values.statut}>
          <option value="">Ouvertes (à faire, en cours)</option>
          <option value="a_faire">À faire</option>
          <option value="en_cours">En cours</option>
          <option value="fait">Faites</option>
          <option value="toutes">Toutes</option>
        </Select>
        <Select name="responsable" label="Responsable" value={values.responsable}>
          <option value="">Tout le monde</option>
          <option value={meId}>Moi</option>
          <option value="none">Personne</option>
          {users
            .filter((u) => u.id !== meId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </Select>
        <Select name="categorie" label="Catégorie" value={values.categorie}>
          <option value="">Toutes</option>
          {Object.entries(CATEGORY_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="priorite" label="Priorité" value={values.priorite}>
          <option value="">Toutes</option>
          {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="objet" label="Dans l'objet" value={values.objet}>
          <option value="">Tous les objets</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="tag" label="Tag" value={values.tag}>
          <option value="">Tous</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </Select>
        <label className="field">
          <span>Échéance avant le</span>
          <input className="input" type="date" name="avant" defaultValue={values.avant} />
        </label>
        <Select name="tri" label="Trier par" value={values.tri}>
          <option value="">Échéance</option>
          <option value="priorite">Priorité</option>
          <option value="ratio">Valeur par heure</option>
          <option value="recent">Plus récentes</option>
        </Select>
      </div>
      {Object.entries(values).some(([k, v]) => v && k !== "tri") && (
        <Link href="/taches" className="w-fit text-sm text-moss underline-offset-4 hover:underline">
          Effacer les filtres
        </Link>
      )}
    </form>
  );
}

function Select({ name, label, value, children }: { name: string; label: string; value: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" name={name} defaultValue={value} key={value}>
        {children}
      </select>
    </label>
  );
}
