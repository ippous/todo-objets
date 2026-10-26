"use client";

import { useFormStatus } from "react-dom";

export function Submit({
  children,
  pendingLabel,
  className = "btn btn-primary",
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
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
