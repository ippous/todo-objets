"use client";

// Boutons d'aide IA d'une tâche. Ils vivent dans le formulaire de la tâche :
// ils lisent le titre et la description en cours de saisie (même non enregistrés).
import { LoaderCircle, MessageSquareText, Sparkles, WandSparkles } from "lucide-react";
import { IconLabel, Tip } from "./tip";
import { useState, useTransition, type RefObject } from "react";
import { aiProposeAction, aiProposeObjectTasksAction, applyAiProposalsAction, applyObjectTasksAction } from "@/app/ai-actions";
import type { SubtaskProposal, TaskProposal } from "@/lib/task-assistant";
import type { RichTextApi } from "./rich-text-editor";
import { FormError } from "./submit";

export type AiChoice = { providers: { id: string; label: string }[]; defaultProvider: string | null };

function readDraft(el: HTMLElement | null) {
  const form = el?.closest("form");
  const fd = form ? new FormData(form) : null;
  const field = (n: string) => String(fd?.get(n) ?? "");
  return {
    // « title » pour une tâche, « name » pour un objet
    title: field("title") || field("name"),
    description: field("description") || null,
    // Pour un élément pas encore créé : son objet (tâche) ou son parent (objet)
    objectId: field("objectId") || null,
    parentId: field("parentId") || null,
  };
}

/** Choix du fournisseur, seulement s'il y en a plusieurs de configurés. */
function ProviderSelect({ ai, value, onChange }: { ai: AiChoice; value: string; onChange: (v: string) => void }) {
  if (ai.providers.length < 2) return null;
  return (
    <select
      className="min-h-9 rounded-md border border-line bg-surface px-2 text-sm"
      aria-label="Assistant IA à utiliser"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {ai.providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

const aiBtn = "btn btn-ghost min-h-9 min-w-11 gap-1.5 px-3 text-sm";

/** Bouton d'aide IA : icône seule sur mobile (info-bulle à l'appui long), icône et texte au-delà. */
function AiButton({
  icon,
  label,
  pendingLabel,
  pending = false,
  disabled = false,
  onClick,
  className = "",
  expanded,
}: {
  icon: React.ReactNode;
  label: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  expanded?: boolean;
}) {
  const shown = pending && pendingLabel ? pendingLabel : label;
  return (
    <Tip label={shown}>
      <button
        type="button"
        className={`${aiBtn} ${className}`}
        aria-label={shown}
        aria-expanded={expanded}
        onClick={onClick}
        disabled={disabled || pending}
      >
        <IconLabel icon={pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : icon} label={shown} />
      </button>
    </Tip>
  );
}

function NotConfigured({ isAdmin }: { isAdmin: boolean }) {
  return (
    <p className="text-sm text-muted">
      Aucun assistant IA n&apos;est configuré.{" "}
      {isAdmin ? (
        <a href="/utilisateurs/ia" className="text-moss underline-offset-4 hover:underline">
          Ajouter une clé d&apos;API
        </a>
      ) : (
        "Demande à un administrateur d'ajouter une clé d'API."
      )}
    </p>
  );
}

type Draft = { title: string; description: string | null; objectId?: string | null; parentId?: string | null };

/** « Compléter la description » : propose une description, qu'on accepte ou non (tâche ou objet). */
export function DescriptionAssist({
  complete,
  ai,
  isAdmin,
  editor,
  label = "Compléter la description",
}: {
  complete: (draft: Draft, provider: string | null) => Promise<{ html?: string; error?: string }>;
  ai: AiChoice;
  isAdmin: boolean;
  editor: RefObject<RichTextApi | null>;
  label?: string;
}) {
  const [provider, setProvider] = useState(ai.defaultProvider ?? ai.providers[0]?.id ?? "");
  const [proposal, setProposal] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (!ai.providers.length) {
    return (
      <div className="grid gap-1" ref={setAnchor}>
        <AiButton icon={<WandSparkles size={16} aria-hidden />} label={label} disabled className="w-fit" />
        <NotConfigured isAdmin={isAdmin} />
      </div>
    );
  }

  const run = () =>
    start(async () => {
      setError(null);
      setApplied(false);
      const draft = readDraft(anchor);
      const r = await complete({ ...draft, description: editor.current?.getHtml() ?? draft.description }, provider);
      if (r.error) setError(r.error);
      else setProposal(r.html ?? null);
    });

  return (
    <div className="grid gap-2" ref={setAnchor}>
      <div className="flex flex-wrap items-center gap-2">
        <AiButton icon={<WandSparkles size={16} aria-hidden />} label={label} pendingLabel="Rédaction en cours…" pending={pending} onClick={run} />
        <ProviderSelect ai={ai} value={provider} onChange={setProvider} />
        {applied && (
          <span role="status" className="text-sm text-moss">
            Description remplacée : pense à enregistrer.
          </span>
        )}
      </div>
      {proposal && (
        <div className="grid gap-3 rounded-xl border border-moss bg-surface p-3" data-testid="proposition-description">
          <p className="text-sm font-bold text-moss">Proposition de description</p>
          {/* HTML nettoyé côté serveur (mêmes balises que l'éditeur) */}
          <div className="rich" dangerouslySetInnerHTML={{ __html: proposal }} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary min-h-9 px-3 text-sm"
              onClick={() => {
                editor.current?.setHtml(proposal);
                setProposal(null);
                setApplied(true);
              }}
            >
              Remplacer la description
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={run} disabled={pending}>
              Autre proposition
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setProposal(null)}>
              Ignorer
            </button>
          </div>
        </div>
      )}
      <FormError error={error ?? undefined} />
    </div>
  );
}

type Checked = { checked: boolean };

/** « Proposer des sous-tâches » : liste à cocher de sous-tâches et de tâches voisines. */
export function SubtaskAssist({ todoId, ai, isAdmin }: { todoId: string; ai: AiChoice; isAdmin: boolean }) {
  const [provider, setProvider] = useState(ai.defaultProvider ?? ai.providers[0]?.id ?? "");
  const [subs, setSubs] = useState<(SubtaskProposal & Checked)[] | null>(null);
  const [tasks, setTasks] = useState<(TaskProposal & Checked)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Dernière consigne donnée, reprise par « Autres propositions »
  const [last, setLast] = useState<string | null>(null);

  if (!ai.providers.length) {
    return (
      <div className="grid gap-1" ref={setAnchor}>
        <AiButton icon={<Sparkles size={16} aria-hidden />} label="Proposer des sous-tâches" disabled className="w-fit" />
        <NotConfigured isAdmin={isAdmin} />
      </div>
    );
  }

  const run = (instructions: string | null = null) =>
    start(async () => {
      setError(null);
      setDone(null);
      setLast(instructions);
      const r = await aiProposeAction(todoId, readDraft(anchor), provider, instructions);
      if (r.error) return setError(r.error);
      setSubs((r.subtasks ?? []).map((s) => ({ ...s, checked: true })));
      // Les autres tâches ne sont pas cochées d'office : on les choisit une par une
      setTasks((r.tasks ?? []).map((t) => ({ ...t, checked: false })));
    });

  const apply = () =>
    start(async () => {
      setError(null);
      const r = await applyAiProposalsAction(todoId, {
        subtasks: (subs ?? []).filter((s) => s.checked).map(({ title, estHours }) => ({ title, estHours })),
        tasks: tasks.filter((t) => t.checked).map(({ title, description, estHours }) => ({ title, description, estHours })),
      });
      if (r.error) return setError(r.error);
      const parts = [
        r.subtasks ? `${r.subtasks} sous-tâche${r.subtasks > 1 ? "s" : ""}` : null,
        r.tasks ? `${r.tasks} tâche${r.tasks > 1 ? "s" : ""}` : null,
      ].filter(Boolean);
      setDone(parts.length ? `Ajouté : ${parts.join(" et ")}.` : "Rien n'était coché.");
      setSubs(null);
      setTasks([]);
    });

  const count = (subs ?? []).filter((s) => s.checked).length + tasks.filter((t) => t.checked).length;

  return (
    <div className="grid gap-2" ref={setAnchor}>
      <div className="flex flex-wrap items-center gap-2">
        <AiButton
          icon={<Sparkles size={16} aria-hidden />}
          label="Proposer des sous-tâches"
          pendingLabel={subs ? undefined : "Réflexion en cours…"}
          pending={pending}
          onClick={() => run()}
        />
        <InstructionsButton pending={pending} onRun={run} placeholder="Ex. : en 3 étapes maximum, avec le matériel à acheter" />
        <ProviderSelect ai={ai} value={provider} onChange={setProvider} />
        {done && (
          <span role="status" className="text-sm text-moss">
            {done}
          </span>
        )}
      </div>
      {subs && (
        <div className="grid gap-3 rounded-xl border border-moss bg-surface p-3" data-testid="propositions-ia">
          {subs.length > 0 && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-bold text-moss">Sous-tâches proposées</legend>
              {subs.map((s, i) => (
                <label key={i} className="flex min-h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-moss"
                    checked={s.checked}
                    onChange={(e) => setSubs((l) => l!.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                  />
                  <span className="min-w-0 flex-1">{s.title}</span>
                  {s.estHours != null && <span className="num shrink-0 text-sm text-muted">{String(s.estHours).replace(".", ",")} h</span>}
                </label>
              ))}
            </fieldset>
          )}
          {tasks.length > 0 && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm font-bold text-moss">Autres tâches suggérées, sur le même objet</legend>
              {tasks.map((t, i) => (
                <label key={i} className="flex items-start gap-2 py-1">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-moss"
                    checked={t.checked}
                    onChange={(e) => setTasks((l) => l.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">{t.title}</span>
                    {t.description && <span className="block text-sm text-muted">{t.description}</span>}
                  </span>
                  {t.estHours != null && <span className="num shrink-0 text-sm text-muted">{String(t.estHours).replace(".", ",")} h</span>}
                </label>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={apply} disabled={pending || count === 0}>
              {pending ? "Ajout…" : `Ajouter la sélection (${count})`}
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => run(last)} disabled={pending}>
              Autres propositions
            </button>
            <button
              type="button"
              className="btn btn-ghost min-h-9 px-3 text-sm"
              onClick={() => {
                setSubs(null);
                setTasks([]);
              }}
            >
              Ignorer
            </button>
          </div>
        </div>
      )}
      <FormError error={error ?? undefined} />
    </div>
  );
}

/** « Proposer des tâches » sur un objet : liste à cocher, tâches créées sur l'objet. */
export function ObjectTaskAssist({
  objectId,
  ai,
  isAdmin,
  leading,
  quiet = false,
}: {
  objectId: string;
  ai: AiChoice;
  isAdmin: boolean;
  /** Boutons placés en tête de la même ligne (ex. « Enregistrer »). */
  leading?: React.ReactNode;
  /** Ne pas répéter « Aucun assistant IA n'est configuré » (déjà affiché plus haut). */
  quiet?: boolean;
}) {
  const [provider, setProvider] = useState(ai.defaultProvider ?? ai.providers[0]?.id ?? "");
  const [tasks, setTasks] = useState<(TaskProposal & Checked)[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [last, setLast] = useState<string | null>(null);

  if (!ai.providers.length) {
    return (
      <div className="grid gap-1" ref={setAnchor}>
        <div className="flex flex-wrap items-center gap-2">
          {leading}
          <AiButton icon={<Sparkles size={16} aria-hidden />} label="Proposer des tâches" disabled className="w-fit" />
        </div>
        {!quiet && <NotConfigured isAdmin={isAdmin} />}
      </div>
    );
  }

  const run = (instructions: string | null = null) =>
    start(async () => {
      setError(null);
      setDone(null);
      setLast(instructions);
      const r = await aiProposeObjectTasksAction(objectId, readDraft(anchor), provider, instructions);
      if (r.error) return setError(r.error);
      setTasks((r.tasks ?? []).map((t) => ({ ...t, checked: true })));
    });

  const apply = () =>
    start(async () => {
      setError(null);
      const picked = (tasks ?? []).filter((t) => t.checked).map(({ title, description, estHours }) => ({ title, description, estHours }));
      const r = await applyObjectTasksAction(objectId, picked);
      if (r.error) return setError(r.error);
      setDone(r.tasks ? `${r.tasks} tâche${r.tasks > 1 ? "s" : ""} créée${r.tasks > 1 ? "s" : ""}.` : "Rien n'était coché.");
      setTasks(null);
    });

  const count = (tasks ?? []).filter((t) => t.checked).length;

  return (
    <div className="grid gap-2" ref={setAnchor}>
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <AiButton
          icon={<Sparkles size={16} aria-hidden />}
          label="Proposer des tâches"
          pendingLabel={tasks ? undefined : "Réflexion en cours…"}
          pending={pending}
          onClick={() => run()}
        />
        <InstructionsButton pending={pending} onRun={run} placeholder="Ex. : seulement l'entretien d'hiver" />
        <ProviderSelect ai={ai} value={provider} onChange={setProvider} />
        {done && (
          <span role="status" className="text-sm text-moss">
            {done}
          </span>
        )}
      </div>
      {tasks && (
        <div className="grid gap-3 rounded-xl border border-moss bg-surface p-3" data-testid="propositions-taches">
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-bold text-moss">Tâches proposées pour cet objet</legend>
            {tasks.map((t, i) => (
              <label key={i} className="flex items-start gap-2 py-1">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0 accent-moss"
                  checked={t.checked}
                  onChange={(e) => setTasks((l) => l!.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{t.title}</span>
                  {t.description && <span className="block text-sm text-muted">{t.description}</span>}
                </span>
                {t.estHours != null && <span className="num shrink-0 text-sm text-muted">{String(t.estHours).replace(".", ",")} h</span>}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={apply} disabled={pending || count === 0}>
              {pending ? "Création…" : `Créer les tâches cochées (${count})`}
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => run(last)} disabled={pending}>
              Autres propositions
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setTasks(null)}>
              Ignorer
            </button>
          </div>
        </div>
      )}
      <FormError error={error ?? undefined} />
    </div>
  );
}

/** Second bouton : proposer avec une consigne libre, ajoutée à la demande faite à l'IA. */
function InstructionsButton({
  pending,
  onRun,
  placeholder,
}: {
  pending: boolean;
  onRun: (instructions: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = () => {
    if (!text.trim()) return;
    onRun(text.trim());
    setOpen(false);
  };
  return (
    <>
      <AiButton
        icon={<MessageSquareText size={16} aria-hidden />}
        label="Avec une consigne…"
        expanded={open}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="grid basis-full gap-2 rounded-xl border border-line bg-surface p-3">
          <label className="field">
            <span>Consigne pour l&apos;IA (ajoutée à la demande)</span>
            <textarea
              className="input min-h-20"
              value={text}
              autoFocus
              maxLength={1000}
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Entrée (ou Cmd+Entrée) envoie ; Entrée seule passe à la ligne
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={send} disabled={!text.trim() || pending}>
              Proposer
            </button>
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </>
  );
}
