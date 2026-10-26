import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { BulkAddButton } from "@/components/bulk-add";
import { PhotoGallery } from "@/components/photo-gallery";
import { PhotoUploader } from "@/components/photo-uploader";
import { TodoRow } from "@/components/todo-row";
import { fmtEur, fmtHours } from "@/lib/format";
import { ObjectDocuments } from "@/components/object-documents";
import { ObjectLinks } from "@/components/object-links";
import {
  computeTotals,
  getObject,
  listDocuments,
  listLinks,
  listObjects,
  listPhotos,
  listTodos,
  listUsers,
  type TodoListItem,
} from "@/lib/repo";
import { storageMode, storagePrefix } from "@/lib/storage";
import { buildForest, flatten, pathTo } from "@/lib/tree";

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata(props: PageProps<"/objets/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!UUID.test(id)) return {};
  const obj = await getObject(getDb(), id);
  return { title: obj?.name ?? "Objet" };
}

export default async function ObjetPage(props: PageProps<"/objets/[id]">) {
  const { id } = await props.params;
  const { terminees } = await props.searchParams;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const objs = await listObjects(db);
  const obj = objs.find((o) => o.id === id);
  if (!obj) notFound();

  const showDone = terminees === "1";
  const [all, photos, users, docs, links] = await Promise.all([
    listTodos(db, { subtreeOf: id }, "echeance"),
    listPhotos(db, { objectId: id }),
    listUsers(db),
    listDocuments(db, id),
    listLinks(db, id),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const activeUsers = users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  const cover = photos.find((p) => p.isCover);
  const todos = showDone ? all : all.filter((t) => t.status !== "fait");
  const totals = computeTotals(all);

  // Sous-arbre dans l'ordre d'affichage, pour grouper les tâches par sous-objet
  const subtree = flatten(buildForest(objs)).filter((n) => pathTo(objs, n.id).some((p) => p.id === id));
  const byObject = new Map<string, TodoListItem[]>();
  for (const t of todos) byObject.set(t.objectId, [...(byObject.get(t.objectId) ?? []), t]);
  const groups = subtree.filter((n) => byObject.has(n.id));

  const breadcrumb = pathTo(objs, id);
  const children = objs.filter((o) => o.parentId === id).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "fr"));
  const here = `/objets/${id}${showDone ? "?terminees=1" : ""}`;
  const relPath = (oid: string) =>
    pathTo(objs, oid)
      .slice(breadcrumb.length - 1)
      .map((o) => o.name)
      .join(" › ");

  return (
    <div className="grid gap-6">
      <nav aria-label="Fil d'Ariane" className="text-sm text-muted">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="underline-offset-4 hover:underline">
              Arbre
            </Link>
          </li>
          {breadcrumb.map((o, i) => (
            <li key={o.id} className="flex gap-1">
              <span aria-hidden>›</span>
              {i === breadcrumb.length - 1 ? (
                <span aria-current="page">{o.name}</span>
              ) : (
                <Link href={`/objets/${o.id}`} className="underline-offset-4 hover:underline">
                  {o.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="grid gap-3">
        <div className="flex items-center gap-4">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/photos/${cover.id}?v=1`}
              alt=""
              width={72}
              height={72}
              className="size-18 shrink-0 rounded-xl bg-moss-soft object-cover"
            />
          )}
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-bold">{obj.name}</h1>
            {obj.type && <span className="text-muted">{obj.type}</span>}
          </div>
        </div>
        {(obj.description || obj.location || obj.tags.length > 0) && (
          <div className="grid max-w-prose gap-1 text-muted">
            {obj.description && <p className="whitespace-pre-line text-ink">{obj.description}</p>}
            {obj.location && <p>Emplacement : {obj.location}</p>}
            {obj.tags.length > 0 && <p>{obj.tags.map((t) => `#${t}`).join(" ")}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/taches/nouvelle?objet=${id}&retour=${encodeURIComponent(here)}`} className="btn btn-primary">
            Ajouter une tâche
          </Link>
          <Link href={`/objets/nouveau?parent=${id}`} className="btn btn-ghost">
            Ajouter un sous-objet
          </Link>
          <Link href={`/objets/${id}/modifier`} className="btn btn-ghost">
            Modifier ou déplacer
          </Link>
          <BulkAddButton
            target={{ kind: "taches", objectId: id, objectName: obj.name }}
            users={activeUsers}
            label="Plusieurs tâches"
          />
          <BulkAddButton target={{ kind: "objets", parentId: id, parentName: obj.name }} label="Plusieurs sous-objets" />
        </div>
      </header>

      <section aria-label="Bilan" className="num grid grid-cols-2 gap-3 rounded-xl bg-surface p-4 sm:grid-cols-4">
        <Stat label="Tâches ouvertes" value={String(totals.open.openCount)} />
        <Stat label="Durée prévue" value={fmtHours(totals.open.estHours)} />
        <Stat label="Valeur estimée" value={fmtEur(totals.open.estValueEur)} />
        <Stat
          label="Réalisé (tâches faites)"
          value={`${fmtHours(totals.done.actualHours)} · ${fmtEur(totals.done.actualValueEur)}`}
        />
      </section>

      {children.length > 0 && (
        <section aria-labelledby="sous-objets" className="grid gap-2">
          <h2 id="sous-objets" className="text-lg font-bold">
            Sous-objets
          </h2>
          <ul className="flex flex-wrap gap-2">
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/objets/${c.id}`} className="btn btn-ghost min-h-9 px-3 text-sm">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="taches" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="taches" className="text-lg font-bold">
            Tâches de {obj.name} et de ses sous-objets
          </h2>
          <Link
            href={showDone ? `/objets/${id}` : `/objets/${id}?terminees=1`}
            className="text-sm text-moss underline-offset-4 hover:underline"
          >
            {showDone ? "Masquer les tâches faites" : `Afficher les tâches faites (${totals.done.count})`}
          </Link>
        </div>
        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-muted">
            Aucune tâche ouverte ici. Ajoute-en une pour {obj.name} ou l&apos;un de ses sous-objets.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.id} className="rounded-xl bg-surface px-4 py-2">
              <h3 className="pt-2 text-sm font-bold text-muted">
                {g.id === id ? (
                  obj.name
                ) : (
                  <Link href={`/objets/${g.id}`} className="underline-offset-4 hover:underline">
                    {relPath(g.id)}
                  </Link>
                )}
              </h3>
              <ul>
                {byObject.get(g.id)!.map((t) => (
                  <TodoRow key={t.id} todo={t} returnTo={here} showObject={false} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="documents" className="grid content-start gap-3">
          <h2 id="documents" className="text-lg font-bold">
            Documents {docs.length > 0 && <span className="font-normal text-muted">({docs.length})</span>}
          </h2>
          <ObjectDocuments
            objectId={obj.id}
            prefix={storagePrefix}
            mode={storageMode}
            docs={docs.map((d) => ({
              id: d.id,
              filename: d.filename,
              contentType: d.contentType,
              size: d.size,
              createdAt: d.createdAt.toISOString(),
              createdBy: d.createdById ? (userName.get(d.createdById) ?? null) : null,
            }))}
          />
        </section>
        <section aria-labelledby="liens" className="grid content-start gap-3">
          <h2 id="liens" className="text-lg font-bold">
            Liens {links.length > 0 && <span className="font-normal text-muted">({links.length})</span>}
          </h2>
          <ObjectLinks objectId={obj.id} links={links.map((l) => ({ id: l.id, url: l.url, title: l.title }))} />
        </section>
      </div>

      <section aria-labelledby="photos" className="grid gap-3">
        <h2 id="photos" className="text-lg font-bold">
          Photos {photos.length > 0 && <span className="font-normal text-muted">({photos.length})</span>}
        </h2>
        <PhotoGallery
          label={obj.name}
          photos={photos.map((p) => ({ id: p.id, isCover: p.isCover, width: p.width, height: p.height }))}
        />
        <PhotoUploader kind="objets" ownerId={obj.id} prefix={storagePrefix} mode={storageMode} />
      </section>

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
