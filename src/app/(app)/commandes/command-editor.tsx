"use client";

import { Sparkles } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { aiWriteCommandAction, deleteCommandAction } from "@/app/command-actions";
import { FormError, Submit } from "@/components/submit";
import type { AiChoice } from "@/components/task-ai";
import { runCommandCode, type RunResult } from "@/lib/command-runtime";
import type { ActionState } from "@/lib/forms";

type Values = { name: string; description: string | null; code: string };

/** Contexte d'exemple pour les tests depuis cette page. */
const SAMPLE = { titre: "Repeindre le portail", objet: "Portail" };

export function CommandEditor({
  action,
  id,
  values,
  readOnly,
  ai,
  saved,
  submitLabel,
}: {
  action?: (state: ActionState, fd: FormData) => Promise<ActionState>;
  id?: string;
  values?: Values;
  readOnly: boolean;
  ai: AiChoice;
  saved?: boolean;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action ?? (async () => ({})), {});
  const [name, setName] = useState(values?.name ?? "");
  const [code, setCode] = useState(values?.code ?? "// Renvoie le texte à afficher\nreturn new Date().toLocaleDateString(\"fr-FR\");");
  const [previous, setPrevious] = useState<string | null>(null);
  const [test, setTest] = useState<RunResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [request, setRequest] = useState("");
  const [provider, setProvider] = useState(ai.defaultProvider ?? ai.providers[0]?.id ?? "");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dirty = values ? code !== values.code || name !== values.name : true;

  const runTest = async () => {
    setTesting(true);
    setTest(await runCommandCode(code, name || "essai", SAMPLE));
    setTesting(false);
  };

  const askAi = (fix: boolean) =>
    startAi(async () => {
      setAiError(null);
      const r = await aiWriteCommandAction({
        name,
        request,
        code: fix ? code : null,
        error: fix && test ? (test.ok ? `Résultat : ${test.value}` : `Erreur : ${test.error}`) : null,
        provider,
      });
      if (r.error || !r.code) return setAiError(r.error ?? "Pas de réponse");
      setPrevious(code);
      setCode(r.code);
      setTest(null);
    });

  return (
    <div className="grid max-w-3xl gap-6">
      <form action={formAction} className="grid gap-4">
        <label className="field">
          <span>Nom (utilisé après $$ ou @@)</span>
          <div className="flex items-center gap-1">
            <span className="whitespace-nowrap font-bold text-muted">$$ / @@</span>
            <input
              className="input"
              name="name"
              required
              maxLength={40}
              pattern="[a-z0-9_\-]+"
              title="Lettres minuscules sans accent, chiffres, - ou _"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              readOnly={readOnly}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </label>
        <label className="field">
          <span>Description (affichée dans la liste des raccourcis)</span>
          <input className="input" name="description" maxLength={300} defaultValue={values?.description ?? ""} readOnly={readOnly} />
        </label>
        <label className="field">
          <span>Code JavaScript (corps d&apos;une fonction asynchrone qui reçoit ctx et renvoie le texte)</span>
          <textarea
            className="input min-h-64 font-mono text-sm leading-relaxed"
            name="code"
            required
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={code}
            readOnly={readOnly}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              // Tab indente au lieu de quitter le champ
              if (e.key !== "Tab" || e.shiftKey || readOnly) return;
              e.preventDefault();
              const t = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = t;
              const next = `${code.slice(0, a)}  ${code.slice(b)}`;
              setCode(next);
              requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
            }}
          />
        </label>
        <details className="rounded-lg bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-bold">Ce que reçoit et doit renvoyer le code</summary>
          <ul className="mt-2 grid list-disc gap-1 pl-5 text-muted">
            <li>
              <code>ctx.maintenant</code> : date et heure de l&apos;exécution (texte ISO) ; <code>ctx.titre</code> : titre de la
              tâche ou de l&apos;objet en cours ; <code>ctx.objet</code> : nom de l&apos;objet ; <code>ctx.commande</code> : nom de
              la commande.
            </li>
            <li>
              Renvoyer (<code>return</code>) un texte ou un nombre, sans HTML. <code>await</code> est permis.
            </li>
            <li>Exécuté dans le navigateur, isolé : pas de page (document), pas de réseau (fetch), 2 secondes au plus.</li>
            <li>
              <b>$$nom</b> insère le résultat une fois pour toutes ; <b>@@nom</b> le recalcule à chaque affichage.
            </li>
          </ul>
        </details>

        <section aria-label="Test" className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-ghost" onClick={runTest} disabled={testing}>
              {testing ? "Test…" : "Tester"}
            </button>
            <span className="text-sm text-muted">
              avec titre « {SAMPLE.titre} », objet « {SAMPLE.objet} »
            </span>
          </div>
          {test && (
            <div
              data-testid="resultat-test"
              className={`rounded-lg p-3 text-sm ${test.ok ? "bg-moss-soft text-ink" : "bg-brick-soft text-brick"}`}
            >
              <p className="font-bold">
                {test.ok ? "Résultat" : "Erreur"} <span className="font-normal text-muted">({test.ms} ms)</span>
              </p>
              <p className="whitespace-pre-wrap break-words">{test.ok ? test.value || "(texte vide)" : test.error}</p>
            </div>
          )}
        </section>

        {!readOnly && (
          <section aria-label="Aide de l'IA" className="grid gap-2 rounded-xl bg-surface p-4">
            <h2 className="flex items-center gap-1.5 font-bold">
              <Sparkles size={16} aria-hidden /> Demander à l&apos;IA
            </h2>
            {ai.providers.length === 0 ? (
              <p className="text-sm text-muted">
                Aucun assistant IA configuré.{" "}
                <a href="/utilisateurs/ia" className="text-moss underline-offset-4 hover:underline">
                  Ajouter une clé d&apos;API
                </a>
              </p>
            ) : (
              <>
                <label className="field">
                  <span>Ce que doit faire la commande (ou ce qui ne va pas)</span>
                  <textarea
                    className="input min-h-20"
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    placeholder="Ex. : le numéro de la semaine, « semaine 45 »"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => askAi(false)} disabled={aiPending || !request.trim()}>
                    {aiPending ? "Rédaction…" : "Écrire le code"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => askAi(true)} disabled={aiPending || !code.trim()}>
                    Corriger le code{test && !test.ok ? " (avec l'erreur du test)" : ""}
                  </button>
                  {ai.providers.length > 1 && (
                    <select
                      className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm"
                      aria-label="Assistant IA à utiliser"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                    >
                      {ai.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {previous !== null && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setCode(previous);
                        setPrevious(null);
                        setTest(null);
                      }}
                    >
                      Revenir au code précédent
                    </button>
                  )}
                </div>
                {previous !== null && (
                  <p role="status" className="text-sm text-moss">
                    Code proposé par l&apos;IA : teste-le, puis enregistre.
                  </p>
                )}
                <FormError error={aiError ?? undefined} />
              </>
            )}
          </section>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Submit>{submitLabel}</Submit>
            {(state.ok || (saved && !dirty)) && !dirty ? (
              <span role="status" className="text-sm text-moss">
                Enregistrée.
              </span>
            ) : (
              dirty && values && <span className="text-sm text-muted">Modifications non enregistrées</span>
            )}
          </div>
        )}
        <FormError error={state.error} />
      </form>

      {!readOnly && id && (
        <div className="grid gap-2 border-t border-line pt-4">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Supprimer « {values?.name} » ? Les @@{values?.name} déjà posés afficheront une erreur.</span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    const r = await deleteCommandAction(id);
                    if (r?.error) setDeleteError(r.error);
                  })
                }
              >
                Oui, supprimer
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Non
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost w-fit text-brick" onClick={() => setConfirmDelete(true)}>
              Supprimer la commande
            </button>
          )}
          <FormError error={deleteError ?? undefined} />
        </div>
      )}
    </div>
  );
}
