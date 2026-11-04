import type { Metadata } from "next";
import { ClipboardPlus, FolderPlus, FolderTree, Images, ListPlus, Pencil } from "lucide-react";
import Link from "next/link";
import { IconLabel, Tip } from "@/components/tip";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { AuditTrail } from "@/components/audit-trail";
import { BulkAddButton } from "@/components/bulk-add";
import { PhotoGallery } from "@/components/photo-gallery";
import { PhotoUploader } from "@/components/photo-uploader";
import { TodoRow } from "@/components/todo-row";
import { fmtDate, fmtEur, fmtHours, todayIso } from "@/lib/format";
import { progressOf } from "@/lib/gantt";
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
  listTypes,
  listUsers,
  type TodoListItem,
} from "@/lib/repo";
import { listAudit } from "@/lib/audit";
import { renderRichText } from "@/lib/rich-text";
import { ObjectDescription } from "@/components/object-description";
import { getAiChoice } from "@/lib/ai";
import { getCurrentUser } from "@/lib/session";
import { storageMode, storagePrefix } from "@/lib/storage";
import { buildForest, flatten, pathTo } from "@/lib/tree";

const UUID = /^[0-9a-f-]{36}$/i;

export async function generateMetadata(props: PageProps<"/objets/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  if (!UUID.test(id)) return {};
  const obj = await getObject(getDb(), id);
  return { title: obj?.name ?? "Objet" };
}

/** Bouton d'action de la fiche : carré (icône seule) sur mobile, icône et texte à partir de « sm ». */
const iconBtn = "min-w-11 px-3 sm:px-4";

export default async function ObjetPage(props: PageProps<"/objets/[id]">) {
  const { id } = await props.params;
  const { terminees } = await props.searchParams;
  if (!UUID.test(id)) notFound();
  const db = getDb();
  const objs = await listObjects(db);
  const obj = objs.find((o) => o.id === id);
  if (!obj) notFound();

  const showDone = terminees === "1";
  const [all, photos, users, docs, links, objectTypes, docTypes, history, taskTypes] = await Promise.all([
    listTodos(db, { subtreeOf: id }, "echeance"),
    listPhotos(db, { objectId: id }),
    listUsers(db),
    listDocuments(db, { objectId: id }),
    listLinks(db, { objectId: id }),
    listTypes(db, "objet"),
    listTypes(db, "document"),
    listAudit(db, { objectId: id, limit: 30 }),
    listTypes(db, "tache"),
  ]);
  const [ai, me] = await Promise.all([getAiChoice(db), getCurrentUser()]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const activeUsers = users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  const cover = photos.find((p) => p.isCover);
  const todos = showDone ? all : all.filter((t) => t.status !== "fait");
  const totals = computeTotals(all);
  const progress = progressOf(all, todayIso());

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
        {(obj.location || obj.tags.length > 0) && (
          <div className="grid max-w-prose gap-1 text-muted">
            {obj.location && <p>Emplacement : {obj.location}</p>}
            {obj.tags.length > 0 && <p>{obj.tags.map((t) => `#${t}`).join(" ")}</p>}
          </div>
        )}
        {/* Sur mobile : icônes seules sur une ligne (nom lu par les lecteurs d'écran, info-bulle à l'appui long) */}
        <div className="flex flex-wrap gap-2">
          <Tip label="Ajouter une tâche">
            <Link
              href={`/taches/nouvelle?objet=${id}&retour=${encodeURIComponent(here)}`}
              className={`btn btn-primary ${iconBtn}`}
              aria-label="Ajouter une tâche"
            >
              <IconLabel icon={<ClipboardPlus size={18} aria-hidden />} label="Ajouter une tâche" />
            </Link>
          </Tip>
          <Tip label="Ajouter un sous-objet">
            <Link href={`/objets/nouveau?parent=${id}`} className={`btn btn-ghost ${iconBtn}`} aria-label="Ajouter un sous-objet">
              <IconLabel icon={<FolderPlus size={18} aria-hidden />} label="Ajouter un sous-objet" />
            </Link>
          </Tip>
          <Tip label="Modifier ou déplacer">
            <Link href={`/objets/${id}/modifier`} className={`btn btn-ghost ${iconBtn}`} aria-label="Modifier ou déplacer">
              <IconLabel icon={<Pencil size={18} aria-hidden />} label="Modifier ou déplacer" />
            </Link>
          </Tip>
          <Tip label="Photos">
            <a
              href="#photos"
              className={`btn btn-ghost ${iconBtn}`}
              aria-label={`Photos${photos.length > 0 ? ` (${photos.length})` : ""}`}
            >
              <Images size={18} aria-hidden />
              <span aria-hidden>
                <span className="hidden sm:inline">Photos</span>
                {photos.length > 0 && <span className="num sm:ml-1">{`${photos.length}`}</span>}
              </span>
            </a>
          </Tip>
          <BulkAddButton
            target={{ kind: "taches", objectId: id, objectName: obj.name }}
            users={activeUsers}
            taskTypes={taskTypes.map((t) => ({ id: t.id, name: t.name }))}
            label="Plusieurs tâches"
            icon={<ListPlus size={18} aria-hidden />}
            className={`btn btn-ghost ${iconBtn}`}
          />
          <BulkAddButton
            target={{ kind: "objets", parentId: id, parentName: obj.name }}
            objectTypes={objectTypes}
            label="Plusieurs sous-objets"
            icon={<FolderTree size={18} aria-hidden />}
            className={`btn btn-ghost ${iconBtn}`}
          />
        </div>
      </header>

      <section aria-label="Description de l'objet" className="grid gap-2">
        <ObjectDescription
          objectId={obj.id}
          name={obj.name}
          description={obj.description ? renderRichText(obj.description) : null}
          storage={{ prefix: storagePrefix, mode: storageMode }}
          ai={ai}
          isAdmin={me?.role === "admin"}
        />
      </section>

      <section aria-labelledby="photos" className="grid scroll-mt-4 gap-3">
        <h2 id="photos" className="text-lg font-bold">
          Photos {photos.length > 0 && <span className="font-normal text-muted">({photos.length})</span>}
        </h2>
        <PhotoGallery
          label={obj.name}
          photos={photos.map((p) => ({ id: p.id, isCover: p.isCover, width: p.width, height: p.height, description: p.description }))}
        />
        <PhotoUploader kind="objets" ownerId={obj.id} prefix={storagePrefix} mode={storageMode} />
        <p className="text-sm text-muted">
          {photos.length === 0
            ? "La première photo devient la vignette de l'objet (affichée dans l'arbre) ; tu pourras en choisir une autre."
            : "« Utiliser comme vignette » sous une photo pour en faire la vignette de l'objet."}
        </p>
      </section>

      {progress.total > 0 && (
        <section aria-labelledby="avancement" className="grid gap-3 rounded-xl bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="avancement" className="text-lg font-bold">
              Avancement
            </h2>
            <Link
              href={`/taches?vue=gantt&statut=toutes&objet=${id}`}
              className="text-sm font-bold text-moss underline-offset-4 hover:underline"
            >
              Voir le Gantt →
            </Link>
          </div>
          <div
            role="progressbar"
            aria-label="Tâches faites"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.pct}
            className="h-3 overflow-hidden rounded-full bg-paper"
          >
            <div className="h-full rounded-full bg-moss" style={{ width: `${progress.pct}%` }} />
          </div>
          <dl className="num grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">Tâches faites</dt>
              <dd className="text-lg font-bold">
                {progress.done} / {progress.total} <span className="text-sm font-normal text-muted">({progress.pct} %)</span>
              </dd>
            </div>
            {progress.hoursPct != null && (
              <div>
                <dt className="text-muted">Heures prévues faites</dt>
                <dd className="text-lg font-bold">
                  {fmtHours(progress.doneEstHours)} / {fmtHours(progress.estHours)}{" "}
                  <span className="text-sm font-normal text-muted">({progress.hoursPct} %)</span>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted">Fin prévue</dt>
              <dd className="text-lg font-bold">{progress.plannedEnd ? fmtDate(progress.plannedEnd) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">En retard · bloquées</dt>
              <dd className={`text-lg font-bold ${progress.late ? "text-brick" : ""}`}>
                {progress.late} · {progress.blocked}
              </dd>
            </div>
          </dl>
        </section>
      )}

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
            owner={{ kind: "objets", id: obj.id }}
            prefix={storagePrefix}
            mode={storageMode}
            docTypes={docTypes.map((t) => ({ id: t.id, name: t.name }))}
            docs={docs.map((d) => ({
              id: d.id,
              typeId: d.typeId,
              typeName: d.typeName,
              description: d.description,
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
          <ObjectLinks owner={{ kind: "objets", id: obj.id }} links={links.map((l) => ({ id: l.id, url: l.url, title: l.title, description: l.description }))} />
        </section>
      </div>

      <HistorySection entries={history} href={`/journal?objet=${id}`} />
    </div>
  );
}

function HistorySection({ entries, href }: { entries: Awaited<ReturnType<typeof listAudit>>; href: string }) {
  return (
    <details className="rounded-xl bg-surface p-4">
      <summary className="cursor-pointer font-bold">Historique de l&apos;objet et de ses tâches</summary>
      <div className="mt-3 grid gap-2">
        <AuditTrail entries={entries} showEntity="taches" />
        {entries.length >= 30 && (
          <Link href={href} className="text-sm text-moss underline-offset-4 hover:underline">
            Tout l&apos;historique
          </Link>
        )}
      </div>
    </details>
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
