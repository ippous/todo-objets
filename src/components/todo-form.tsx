"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import type { Todo } from "@/db/schema";
import { fmtNum, PRIORITY_LABEL, RECURRENCE_LABEL, STATUS_LABEL } from "@/lib/format";
import type { ActionState } from "@/lib/forms";
import { DescriptionField, type DescriptionFieldProps } from "./description-field";
import type { AiChoice } from "./task-ai";
import type { ObjectOption } from "@/lib/options";
import { TaskIcon } from "@/lib/task-icons";
import { FormError } from "./submit";
import { DependencyPicker, type DependencyCandidate } from "./dependency-picker";

type Values = Pick<
  Todo,
  | "objectId"
  | "title"
  | "description"
  | "typeId"
  | "priority"
  | "status"
  | "estHours"
  | "actualHours"
  | "estValueEur"
  | "actualValueEur"
  | "startDate"
  | "dueDate"
  | "dueTime"
  | "reminderSchemeId"
  | "recurrence"
  | "assigneeId"
  | "tags"
>;

export function TodoForm({
  action,
  values,
  objectId,
  objects,
  users,
  types,
  schemes,
  dependencies,
  returnTo,
  submitLabel,
  afterDescription,
  beforeSubmit,
  subtaskHours,
  description,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  objectId?: string;
  objects: ObjectOption[];
  users: { id: string; name: string }[];
  types: { id: string; name: string; icon: string | null }[];
  /** Schémas de rappel ; `offsets` déjà mis en forme (« J-10 / J-1 / H-3 »). */
  schemes: { id: string; name: string; offsets: string; isDefault: boolean }[];
  /** Tâches que celle-ci peut attendre, et celles qu'elle attend déjà. */
  dependencies: { candidates: DependencyCandidate[]; value: string[] };
  returnTo: string;
  submitLabel: string;
  /** Contenu affiché juste sous la description (les sous-tâches). */
  afterDescription?: React.ReactNode;
  /**
   * Contenu affiché entre les champs et le bouton d'enregistrement (documents, liens).
   * Il est rendu hors du <form> : il peut contenir ses propres formulaires.
   */
  beforeSubmit?: React.ReactNode;
  /** Somme des durées des sous-tâches, utilisée quand la tâche n'a pas sa propre durée. */
  subtaskHours?: { estHours: number | null; actualHours: number | null };
  /** Zone de description : tâche décrite (id null à la création), stockage des images, aide IA. */
  description: { todoId: string | null; storage: DescriptionFieldProps["storage"]; ai: AiChoice; isAdmin: boolean };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formId = useId();
  const [status, setStatus] = useState(values?.status ?? "a_faire");
  // Nouvelle tâche : « Entretien » par défaut, comme l'ancienne catégorie
  const [typeId, setTypeId] = useState(
    values ? (values.typeId ?? "") : (types.find((t) => t.name.toLowerCase() === "entretien")?.id ?? ""),
  );
  const typeIcon = types.find((t) => t.id === typeId)?.icon;
  const [due, setDue] = useState({ date: values?.dueDate ?? "", time: values?.dueTime?.slice(0, 5) ?? "" });
  // Nouvelle tâche : le schéma par défaut est proposé
  const [schemeId, setSchemeId] = useState(values ? (values.reminderSchemeId ?? "") : (schemes.find((x) => x.isDefault)?.id ?? ""));
  const scheme = schemes.find((x) => x.id === schemeId);
  const schemeHasHm = !!scheme && /[HM]-/.test(scheme.offsets);
  const [est, setEst] = useState({ h: fmtNum(values?.estHours), v: fmtNum(values?.estValueEur) });
  const h = est.h.trim() === "" && subtaskHours?.estHours != null ? subtaskHours.estHours : Number(est.h.replace(",", "."));
  const v = Number(est.v.replace(",", "."));
  const ratio = h > 0 && v >= 0 && est.v !== "" ? Math.round((v / h) * 100) / 100 : null;

  return (
    <div className="grid max-w-2xl gap-5">
      <form id={formId} action={formAction} className="grid min-w-0 gap-5">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="field">
          <span>Titre</span>
          <input className="input" name="title" required maxLength={200} defaultValue={values?.title} autoFocus={!values} />
        </label>
        <label className="field">
          <span>Objet concerné</span>
          <select className="input" name="objectId" required defaultValue={values?.objectId ?? objectId ?? ""}>
            <option value="" disabled>
              Choisir dans l&apos;arbre…
            </option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <DescriptionField
          owner={{ kind: "tache", id: description.todoId }}
          storage={description.storage}
          ai={description.ai}
          isAdmin={description.isAdmin}
          defaultValue={values?.description}
          commandContext={{
            titre: values?.title ?? null,
            objet: objects.find((o) => o.id === (values?.objectId ?? objectId))?.label.replace(/^[\s└]+/, "") ?? null,
          }}
        />
        {afterDescription}

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Classement</legend>
          <label className="field">
            <span className="flex items-center gap-1.5">
              Type <TaskIcon icon={typeIcon} size={16} className="text-moss" />
            </span>
            <select className="input" name="typeId" aria-label="Type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Aucun</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Priorité</span>
            <select className="input" name="priority" defaultValue={values?.priority ?? "moyenne"}>
              {Object.entries(PRIORITY_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Statut</span>
            <select
              className="input"
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Values["status"])}
            >
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset className="grid gap-3 rounded-xl bg-surface p-4">
          <legend className="px-1 font-bold">Estimé</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>Durée (heures)</span>
              <input
                className="input num"
                name="estHours"
                inputMode="decimal"
                placeholder={subtaskHours?.estHours != null ? `${fmtNum(subtaskHours.estHours)} (sous-tâches)` : undefined}
                value={est.h}
                onChange={(e) => setEst((s) => ({ ...s, h: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Valeur (€)</span>
              <input
                className="input num"
                name="estValueEur"
                inputMode="decimal"
                value={est.v}
                onChange={(e) => setEst((s) => ({ ...s, v: e.target.value }))}
              />
            </label>
          </div>
          <p className="num text-sm text-muted" aria-live="polite">
            {ratio != null ? `Soit ${String(ratio).replace(".", ",")} €/h` : "Le ratio €/h s'affiche dès que durée et valeur sont remplies."}
          </p>
          {subtaskHours?.estHours != null && (
            <p className="text-sm text-muted">Laissée vide, la durée prévue est la somme de celles des sous-tâches.</p>
          )}
        </fieldset>

        <fieldset className={`grid gap-3 rounded-xl p-4 ${status === "fait" ? "bg-moss-soft" : "bg-surface"}`}>
          <legend className="px-1 font-bold">Réalisé</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>Durée (heures)</span>
              <input
                className="input num"
                name="actualHours"
                inputMode="decimal"
                defaultValue={fmtNum(values?.actualHours)}
                placeholder={subtaskHours?.actualHours != null ? `${fmtNum(subtaskHours.actualHours)} (sous-tâches)` : undefined}
              />
            </label>
            <label className="field">
              <span>Valeur (€)</span>
              <input className="input num" name="actualValueEur" inputMode="decimal" defaultValue={fmtNum(values?.actualValueEur)} />
            </label>
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Planification</legend>
          <label className="field">
            <span>Début (facultatif)</span>
            <input className="input" type="date" name="startDate" defaultValue={values?.startDate ?? ""} max={due.date || undefined} />
          </label>
          <label className="field">
            <span>Échéance</span>
            <input
              className="input"
              type="date"
              name="dueDate"
              value={due.date}
              onChange={(e) => setDue((d) => ({ date: e.target.value, time: e.target.value ? d.time : "" }))}
            />
          </label>
          <label className="field">
            <span>Heure (facultative)</span>
            <span className="flex gap-1">
              <input
                className="input min-w-0 flex-1"
                type="time"
                name="dueTime"
                value={due.time}
                disabled={!due.date}
                onChange={(e) => setDue((d) => ({ ...d, time: e.target.value }))}
              />
              {due.time && (
                <button type="button" className="btn btn-ghost px-3" aria-label="Retirer l'heure" onClick={() => setDue((d) => ({ ...d, time: "" }))}>
                  ×
                </button>
              )}
            </span>
          </label>
          <label className="field">
            <span>Rappels</span>
            <select className="input" name="reminderSchemeId" value={schemeId} onChange={(e) => setSchemeId(e.target.value)}>
              <option value="">Aucun</option>
              {schemes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.offsets}
                </option>
              ))}
            </select>
          </label>
          {scheme && (
            <p className="text-sm text-muted sm:col-span-3">
              {!due.date
                ? "Les rappels partiront dès qu'une échéance sera fixée."
                : due.time
                  ? `Rappels ${scheme.offsets}, comptés depuis le ${due.date.split("-").reverse().join("/")} à ${due.time}.`
                  : `Rappels J à 8 h${schemeHasHm ? " ; les rappels H et M demandent une heure d'échéance" : ""}.`}{" "}
              Ils vont au responsable, ou à défaut à la personne qui a créé la tâche.
            </p>
          )}
          <label className="field">
            <span>Récurrence</span>
            <select className="input" name="recurrence" defaultValue={values?.recurrence ?? "aucune"}>
              {Object.entries(RECURRENCE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Responsable</span>
            <select className="input" name="assigneeId" defaultValue={values?.assigneeId ?? ""}>
              <option value="">Personne</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <DependencyPicker candidates={dependencies.candidates} value={dependencies.value} />

        <label className="field">
          <span>Tags, séparés par des virgules</span>
          <input className="input" name="tags" defaultValue={values?.tags.join(", ") ?? ""} />
        </label>
      </form>
      {beforeSubmit}
      <FormError error={state.error} />
      <div className="flex gap-2">
        {/* Relié au formulaire par son id : le contenu « beforeSubmit » reste hors du <form> */}
        <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
          {pending ? "Enregistrement…" : submitLabel}
        </button>
        <Link href={returnTo} className="btn btn-ghost">
          Annuler
        </Link>
      </div>
    </div>
  );
}
