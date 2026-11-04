"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type ToolCall = { id: string; name: string; args: Record<string, unknown>; ok?: boolean; summary?: string };
type Message = { role: "user" | "assistant"; text: string; tools?: ToolCall[]; error?: string };

const STORE = (userId: string) => `carnet-chat-${userId}`;
const MAX_KEPT = 60;

const SUGGESTIONS = [
  "Quelles tâches sont en retard ou à faire cette semaine ?",
  "Résume l'avancement des pâtures de Bouhy",
  "Crée une tâche « Vidanger le tracteur » pour le mois prochain",
  "Quelles tâches sont bloquées, et par quoi ?",
];

const TOOL_LABEL: Record<string, string> = {
  vue_ensemble: "Vue d'ensemble",
  lister_objets: "Arbre des objets",
  rechercher_taches: "Recherche de tâches",
  obtenir_objet: "Fiche d'objet",
  obtenir_tache: "Fiche de tâche",
  consulter_historique: "Journal",
  voir_photo: "Photo",
  lire_document: "Document",
  creer_tache: "Création de tâche",
  modifier_tache: "Modification de tâche",
  creer_objet: "Création d'objet",
  modifier_objet: "Modification d'objet",
  deplacer_objet: "Déplacement d'objet",
  ajouter_lien: "Ajout de lien",
  ajouter_photo: "Ajout de photo",
  ajouter_document: "Ajout de document",
  ajouter_sous_taches: "Ajout de sous-tâches",
  modifier_sous_tache: "Sous-tâche",
};
const WRITES = /^(creer|modifier|deplacer|ajouter|supprimer)_/;

// ---------- Markdown minimal (sans HTML injecté) ----------

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<ChatLink key={k} href={m[2]} label={m[1]} />);
    else if (m[3]) out.push(<strong key={k}>{m[3]}</strong>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-paper px-1 text-[0.9em]">{m[4]}</code>);
    else if (m[5]) out.push(<ChatLink key={k} href={m[5]} label={m[5]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function ChatLink({ href, label }: { href: string; label: string }) {
  const internal = href.startsWith("/") || (typeof window !== "undefined" && href.startsWith(window.location.origin));
  return (
    <a
      href={href}
      className="font-bold text-moss underline underline-offset-4"
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
    >
      {label}
    </a>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? "list-decimal" : "list-disc"} grid gap-0.5 pl-5`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(
      h ? (
        <p key={blocks.length} className="font-bold">
          {inline(h[1], `h${blocks.length}`)}
        </p>
      ) : (
        <p key={blocks.length}>{inline(line, `p${blocks.length}`)}</p>
      ),
    );
  }
  flush();
  return <div className="grid gap-2">{blocks}</div>;
}

// ---------- Panneau ----------

export function ChatPanel({
  providers,
  defaultProvider,
  userId,
}: {
  providers: { id: string; label: string }[];
  defaultProvider: string;
  userId: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [provider, setProvider] = useState(defaultProvider);
  const [allowDelete, setAllowDelete] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Conversation gardée dans ce navigateur
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE(userId)) ?? "null") as { messages?: Message[]; provider?: string } | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reprise de la conversation après le premier rendu
      if (saved?.messages) setMessages(saved.messages);
      if (saved?.provider && providers.some((p) => p.id === saved.provider)) setProvider(saved.provider);
    } catch {}
  }, [userId, providers]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE(userId), JSON.stringify({ messages: messages.slice(-MAX_KEPT), provider }));
    } catch {}
  }, [messages, provider, userId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, text: q }];
    setMessages([...messages, { role: "user", text: q }, { role: "assistant", text: "", tools: [] }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const update = (fn: (m: Message) => Message) =>
      setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, allowDelete, history: history.map((m) => ({ role: m.role, text: m.text })) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        update((m) => ({ ...m, error: j.error ?? `Erreur ${res.status}` }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as
            | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
            | { type: "tool_result"; id: string; ok: boolean; summary: string }
            | { type: "text"; text: string }
            | { type: "error"; message: string }
            | { type: "done" };
          if (e.type === "text") update((m) => ({ ...m, text: m.text ? `${m.text}\n\n${e.text}` : e.text }));
          else if (e.type === "tool") update((m) => ({ ...m, tools: [...(m.tools ?? []), { id: e.id, name: e.name, args: e.args }] }));
          else if (e.type === "tool_result")
            update((m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === e.id ? { ...t, ok: e.ok, summary: e.summary } : t)) }));
          else if (e.type === "error") update((m) => ({ ...m, error: e.message }));
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") update((m) => ({ ...m, error: "Arrêté." }));
      else update((m) => ({ ...m, error: "La connexion a été coupée. Réessaie." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {providers.length > 1 ? (
          <label className="flex items-center gap-2">
            <span className="text-muted">Modèle</span>
            <select className="input min-h-9 py-1" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-muted">{providers[0].label}</span>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-brick" checked={allowDelete} onChange={(e) => setAllowDelete(e.target.checked)} />
          Autoriser les suppressions
        </label>
        {messages.length > 0 && (
          <button
            type="button"
            className="text-muted underline underline-offset-4 hover:text-ink"
            disabled={busy}
            onClick={() => setMessages([])}
          >
            Nouvelle conversation
          </button>
        )}
      </div>

      <div className="grid gap-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="grid gap-2">
            <p className="text-sm text-muted">Par exemple :</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn btn-ghost min-h-9 px-3 text-left text-sm" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-[85%] justify-self-end rounded-2xl rounded-br-sm bg-moss px-4 py-2 whitespace-pre-wrap text-surface">
              {m.text}
            </div>
          ) : (
            <div key={i} className="grid max-w-[95%] gap-2 justify-self-start">
              {(m.tools?.length ?? 0) > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Outils utilisés">
                  {m.tools!.map((t) => (
                    <li
                      key={t.id}
                      title={`${t.name}(${JSON.stringify(t.args)})${t.summary ? `\n→ ${t.summary}` : ""}`}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        t.ok === false
                          ? "bg-brick-soft text-brick"
                          : WRITES.test(t.name)
                            ? "bg-ochre-soft text-ochre"
                            : "bg-moss-soft text-moss"
                      }`}
                    >
                      {t.ok === undefined ? "⏳ " : t.ok ? "" : "⚠ "}
                      {TOOL_LABEL[t.name] ?? t.name}
                      {t.summary && t.ok !== false ? <span className="font-normal"> · {t.summary}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              {(m.text || (busy && i === messages.length - 1)) && (
                <div className="rounded-2xl rounded-bl-sm bg-surface px-4 py-3">
                  {m.text ? <Markdown text={m.text} /> : <span className="text-muted">Réflexion…</span>}
                </div>
              )}
              {m.error && (
                <p role="alert" className="rounded-lg bg-brick-soft px-3 py-2 text-sm text-brick">
                  {m.error}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-20 grid gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm sm:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message pour l&apos;assistant
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="min-h-12 resize-none bg-transparent px-2 py-1 outline-none"
          rows={2}
          maxLength={4000}
          placeholder="Écris ta demande… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="flex justify-end gap-2">
          {busy ? (
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => abortRef.current?.abort()}>
              Arrêter
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary min-h-9 px-4 text-sm" disabled={busy || !input.trim()}>
            {busy ? "…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}
