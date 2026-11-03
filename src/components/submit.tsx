"use client";

import { useFormStatus } from "react-dom";

export function Submit({
  children,
  pendingLabel,
  className = "btn btn-primary",
  name,
  value,
  ariaLabel,
}: {
  children: React.ReactNode;
  /** Nom accessible quand le contenu visible est une icône seule. */
  ariaLabel?: string;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value} aria-label={ariaLabel}>
      {pending ? (pendingLabel ?? "Enregistrement…") : children}
    </button>
  );
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
      {error}
    </p>
  );
}
