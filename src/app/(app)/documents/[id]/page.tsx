import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/document-viewer";
import { getDb } from "@/db";
import { DOCUMENT_TYPES, formatSize, viewerKind } from "@/lib/document-types";
import { getDocument, listObjects, listTypes } from "@/lib/repo";
import { pathTo } from "@/lib/tree";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

export async function generateMetadata(props: PageProps<"/documents/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Document" };
  const doc = await getDocument(getDb(), id);
  return { title: doc?.filename ?? "Document" };
}

export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const doc = await getDocument(db, id);
  if (!doc) notFound();
  const [objs, types] = await Promise.all([listObjects(db), listTypes(db, "document")]);
  const path = pathTo(objs, doc.objectId);
  const typeName = types.find((t) => t.id === doc.typeId)?.name ?? "";
  const src = `/api/documents/${doc.id}`;

  return (
    <div className="grid gap-4">
      <nav aria-label="Fil d'Ariane" className="text-sm text-muted">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="underline-offset-4 hover:underline">
              Arbre
            </Link>
          </li>
          {path.map((o) => (
            <li key={o.id} className="flex gap-1">
              <span aria-hidden>›</span>
              <Link href={`/objets/${o.id}#documents`} className="underline-offset-4 hover:underline">
                {o.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold">{doc.filename}</h1>
          <p className="num text-sm text-muted">
            {typeName} · {DOCUMENT_TYPES[doc.contentType] ?? "Fichier"} · {formatSize(doc.size)} ·{" "}
            {day.format(new Date(doc.createdAt))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={src} target="_blank" rel="noopener" className="btn btn-ghost">
            Ouvrir à part
          </a>
          <a href={`${src}?telecharger=1`} className="btn btn-primary">
            Télécharger
          </a>
        </div>
      </header>

      <DocumentViewer src={src} kind={viewerKind(doc.contentType)} contentType={doc.contentType} filename={doc.filename} />
    </div>
  );
}
