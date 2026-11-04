import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTodoAction, updateTodoAction } from "@/app/actions";
import { AuditTrail } from "@/components/audit-trail";
import { ObjectDocuments } from "@/components/object-documents";
import { ObjectLinks } from "@/components/object-links";
import { PhotoGallery } from "@/components/photo-gallery";
import { PhotoUploader } from "@/components/photo-uploader";
import { SubtaskList } from "@/components/subtask-list";
import { SubtaskAssist, type AiChoice } from "@/components/task-ai";
import { AI_PROVIDER_LABEL, AI_PROVIDERS, getAiSettings } from "@/lib/ai";
import { getCurrentUser } from "@/lib/session";
import { listReminderSchemes, listTodoDeliveries, upcomingFires } from "@/lib/reminder-repo";
import { formatOffsets } from "@/lib/reminders";
import { getDependencies, isBlocked } from "@/lib/dependencies";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { TaskIcon } from "@/lib/task-icons";
import { TodoForm } from "@/components/todo-form";
import { getDb } from "@/db";
import { listAudit } from "@/lib/audit";
import { objectOptions } from "@/lib/options";
import { listTodos, getTodo, getUser, listDocuments, listLinks, listObjects, listPhotos, listSubtasks, listTypes, listUsers, sumSubtaskHours } from "@/lib/repo";
import { storageMode, storagePrefix } from "@/lib/storage";
import { returnPath } from "@/lib/return-to";
import { DeleteTodo } from "./delete-todo";

export const metadata: Metadata = { title: "Tâche" };

export default async function TachePage(props: PageProps<"/taches/[id]">) {
  const { id } = await props.params;
  const { retour } = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const todo = await getTodo(db, id);
  if (!todo) notFound();
  const [objs, users, creator, photos, docs, links, docTypes, subs, history, taskTypes, aiSettings, me, schemes, deliveries, deps, allTodos] = await Promise.all([
    listObjects(db),
    listUsers(db),
    todo.createdById ? getUser(db, todo.createdById) : undefined,
    listPhotos(db, { todoId: id }),
    listDocuments(db, { todoId: id }),
    listLinks(db, { todoId: id }),
    listTypes(db, "document"),
    listSubtasks(db, id),
    listAudit(db, { todoId: id, limit: 100 }),
    listTypes(db, "tache"),
    getAiSettings(db),
    getCurrentUser(),
    listReminderSchemes(db),
    listTodoDeliveries(db, id, 1),
    getDependencies(db, id),
    listTodos(db, {}),
  ]);
  const blocked = todo.status !== "fait" && isBlocked(deps.attend);
  const waitIds = new Set(deps.attend.map((t) => t.id));
  const candidates = allTodos
    .filter((t) => t.id !== id && (t.status !== "fait" || waitIds.has(t.id)))
    .map((t) => ({ id: t.id, title: t.title, objectName: t.objectName, status: t.status, dueDate: t.dueDate }));
  const scheme = schemes.find((x) => x.id === todo.reminderSchemeId);
  const nextFire = upcomingFires(todo, scheme?.offsets)[0];
  const lastDelivery = deliveries.find((d) => d.outcome !== "saute");
  const at = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const aiChoice: AiChoice = {
    providers: AI_PROVIDERS.filter((p) => aiSettings.providers[p].configured).map((p) => ({ id: p, label: AI_PROVIDER_LABEL[p] })),
    defaultProvider: aiSettings.defaultProvider,
  };
  const ai = { todoId: todo.id, choice: aiChoice, isAdmin: me?.role === "admin" };
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const back = returnPath(retour, `/objets/${todo.objectId}`);
  const created = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(todo.createdAt);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <TaskIcon icon={taskTypes.find((t) => t.id === todo.typeId)?.icon} size={26} className="shrink-0 text-moss" />
          {todo.title}
        </h1>
        <p className="text-sm text-muted">
          Créée le {created}
          {creator ? ` par ${creator.name}` : ""}
        </p>
        {deps.attend.length > 0 && todo.status !== "fait" && (
          <p className={`mt-1 w-fit rounded px-2 py-0.5 text-sm font-bold ${blocked ? "bg-ochre-soft text-ochre" : "bg-moss-soft text-moss"}`}>
            {blocked
              ? `Bloquée : attend ${deps.attend.filter((t) => t.status !== "fait").map((t) => `« ${t.title} »`).join(", ")}`
              : "Prête : les tâches attendues sont faites"}
          </p>
        )}
        {deps.debloque.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Débloque :{" "}
            {deps.debloque.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ", "}
                <Link href={`/taches/${t.id}`} className="text-moss underline-offset-4 hover:underline">
                  {t.title}
                </Link>
                {` (${STATUS_LABEL[t.status].toLowerCase()}${t.dueDate ? `, ${fmtDate(t.dueDate)}` : ""})`}
              </span>
            ))}
          </p>
        )}
        {scheme && todo.dueDate && todo.status !== "fait" && (
          <p className="text-sm text-muted">
            Rappels « {scheme.name} » :{" "}
            {nextFire ? `prochain (${nextFire.label}) le ${at.format(nextFire.at)}` : "plus aucun à venir"}
            {lastDelivery &&
              ` · dernier : ${at.format(lastDelivery.at)}${
                lastDelivery.outcome === "envoye"
                  ? ` (${lastDelivery.channels.join(", ")})`
                  : lastDelivery.outcome === "echec"
                    ? " (échec)"
                    : " (aucun canal actif)"
              }`}
          </p>
        )}
      </div>
      <section aria-labelledby="photos" className="grid max-w-2xl gap-3">
        <h2 id="photos" className="text-lg font-bold">
          Photos {photos.length > 0 && <span className="font-normal text-muted">({photos.length})</span>}
        </h2>
        <PhotoGallery
          label={todo.title}
          photos={photos.map((p) => ({ id: p.id, isCover: p.isCover, width: p.width, height: p.height, description: p.description }))}
        />
        <PhotoUploader kind="taches" ownerId={todo.id} prefix={storagePrefix} mode={storageMode} />
      </section>
      <h2 className="border-t border-line pt-6 text-lg font-bold">Détails de la tâche</h2>
      <TodoForm
        action={updateTodoAction.bind(null, id)}
        values={todo}
        objects={objectOptions(objs)}
        users={users.filter((u) => u.active || u.id === todo.assigneeId).map((u) => ({ id: u.id, name: u.name }))}
        types={taskTypes.map((t) => ({ id: t.id, name: t.name, icon: t.icon }))}
        schemes={schemes.map((x) => ({ id: x.id, name: x.name, offsets: formatOffsets(x.offsets), isDefault: x.isDefault }))}
        dependencies={{ candidates, value: deps.attend.map((t) => t.id) }}
        returnTo={back}
        submitLabel="Enregistrer"
        subtaskHours={sumSubtaskHours(subs)}
        description={{ todoId: todo.id, storage: { prefix: storagePrefix, mode: storageMode }, ai: aiChoice, isAdmin: ai.isAdmin }}
        beforeSubmit={
          <>
            <section aria-labelledby="documents" className="grid min-w-0 content-start gap-3 border-t border-line pt-5">
              <h3 id="documents" className="text-lg font-bold">
                Documents {docs.length > 0 && <span className="font-normal text-muted">({docs.length})</span>}
              </h3>
              <ObjectDocuments
                owner={{ kind: "taches", id: todo.id }}
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
            <section aria-labelledby="liens" className="grid min-w-0 content-start gap-3 border-t border-line pt-5">
              <h3 id="liens" className="text-lg font-bold">
                Liens {links.length > 0 && <span className="font-normal text-muted">({links.length})</span>}
              </h3>
              <ObjectLinks owner={{ kind: "taches", id: todo.id }} links={links.map((l) => ({ id: l.id, url: l.url, title: l.title, description: l.description }))} />
            </section>
          </>
        }
        afterDescription={
          <section aria-labelledby="sous-taches" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
            <h3 id="sous-taches" className="font-bold">
              Sous-tâches
            </h3>
            <SubtaskList
              todoId={todo.id}
              items={subs.map((s) => ({ id: s.id, title: s.title, done: s.done, estHours: s.estHours, actualHours: s.actualHours }))}
            />
            <SubtaskAssist todoId={todo.id} ai={aiChoice} isAdmin={ai.isAdmin} />
          </section>
        }
      />
      <details className="rounded-xl bg-surface p-4">
        <summary className="cursor-pointer font-bold">Historique de la tâche</summary>
        <div className="mt-3">
          <AuditTrail entries={history} showEntity="none" />
        </div>
      </details>
      <DeleteTodo action={deleteTodoAction.bind(null, id)} returnTo={back} />
    </div>
  );
}
