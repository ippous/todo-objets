import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-md gap-4 px-4 py-16">
      <h1 className="text-2xl font-bold">Introuvable</h1>
      <p className="text-muted">Cet objet ou cette tâche n&apos;existe pas, ou a été supprimé.</p>
      <Link href="/" className="btn btn-primary w-fit">
        Revenir à l&apos;arbre
      </Link>
    </main>
  );
}
