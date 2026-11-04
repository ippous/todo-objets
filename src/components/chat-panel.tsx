"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Paperclip, X as Close } from "lucide-react";
import { ACCEPT_ATTR } from "@/lib/document-types";
import { useEffect, useRef, useState, type ReactNode } from "react";

type ToolCall = { id: string; name: string; args: Record<string, unknown>; ok?: boolean; summary?: string };
type Piece = { id: string; name: string; type: string; size: number };
type Message = { role: "user" | "assistant"; text: string; pieces?: Piece[]; tools?: ToolCall[]; error?: string };
/** Pièce en cours d'ajout au prochain message */
type Pending = { key: string; name: string; preview?: string; piece?: Piece; error?: string };

const PIECE_MAX = 4 * 1024 * 1024;
const PIECES_MAX = 6;

/** Image réduite à 1600 px (JPEG) avant envoi : plus rapide, et suffisant pour l'assistant comme pour une photo. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/heic") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) {
      bmp.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

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
  joindre_piece: "Pièce jointe ajoutée",
  ouvrir_page: "Page ouverte",
};
/** Fenêtre de l'assistant ouverte (mémorisé pour l'onglet) — partagé avec la bulle. */
export const CHAT_OPEN_KEY = "carnet-chat-ouvert";
const WRITES = /^(creer|modifier|deplacer|ajouter|supprimer|joindre)_/;

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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const internal = href.startsWith("/") || (!!origin && (href === origin || href.startsWith(`${origin}/`)));
  // Lien interne : navigation dans l'appli, la conversation reste ouverte
  if (internal)
    return (
      <Link href={href.startsWith("/") ? href : href.slice(origin.length) || "/"} className="font-bold text-moss underline underline-offset-4">
        {label}
      </Link>
    );
  return (
    <a
      href={href}
      className="font-bold text-moss underline underline-offset-4"
      target="_blank"
      rel="noopener noreferrer"
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
  compact = false,
}: {
  providers: { id: string; label: string }[];
  defaultProvider: string;
  userId: string;
  /** Fenêtre flottante : options repliées, zone de messages qui défile, saisie en bas. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [showOptions, setShowOptions] = useState(!compact);
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

  // ---------- Pièces jointes ----------
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = pending.some((p) => !p.piece && !p.error);

  const addFiles = (files: File[]) => {
    const room = PIECES_MAX - pending.length;
    for (const raw of files.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const preview = raw.type.startsWith("image/") && raw.type !== "image/heic" ? URL.createObjectURL(raw) : undefined;
      setPending((all) => [...all, { key, name: raw.name || "image.png", preview }]);
      void (async () => {
        const set = (patch: Partial<Pending>) => setPending((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));
        const file = await shrinkImage(raw);
        if (file.size > PIECE_MAX) return set({ error: `${fmtSize(file.size)} : 4 Mo au plus` });
        const fd = new FormData();
        fd.append("file", file, raw.name || file.name || "image.png");
        try {
          const res = await fetch("/api/assistant/pieces", { method: "POST", body: fd });
          const j = (await res.json().catch(() => ({}))) as Piece & { error?: string };
          if (!res.ok) set({ error: j.error ?? `Erreur ${res.status}` });
          else set({ piece: { id: j.id, name: j.name, type: j.type, size: j.size } });
        } catch {
          set({ error: "Envoi impossible" });
        }
      })();
    }
  };
  const removePending = (key: string) =>
    setPending((all) => {
      const p = all.find((x) => x.key === key);
      if (p?.preview) URL.revokeObjectURL(p.preview);
      return all.filter((x) => x.key !== key);
    });

  const send = async (text: string) => {
    const q = text.trim();
    const pieces = pending.flatMap((p) => (p.piece ? [p.piece] : []));
    if ((!q && !pieces.length) || busy || uploading) return;
    const userMsg: Message = { role: "user", text: q, ...(pieces.length ? { pieces } : {}) };
    const history = [...messages.filter((m) => !m.error), userMsg];
    setMessages([...messages, userMsg, { role: "assistant", text: "", tools: [] }]);
    setInput("");
    for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview);
    setPending([]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let wrote = false;
    let goTo: string | null = null;
    const update = (fn: (m: Message) => Message) =>
      setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // La page affichée sert de contexte (« cette tâche », « cet objet »)
        body: JSON.stringify({
          provider,
          allowDelete,
          page: pathname,
          history: history.map((m) => ({ role: m.role, text: m.text, pieces: m.pieces?.map((p) => p.id) })),
        }),
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
            | { type: "navigate"; path: string }
            | { type: "error"; message: string }
            | { type: "done" };
          if (e.type === "text") update((m) => ({ ...m, text: m.text ? `${m.text}\n\n${e.text}` : e.text }));
          else if (e.type === "tool") {
            if (WRITES.test(e.name)) wrote = true;
            update((m) => ({ ...m, tools: [...(m.tools ?? []), { id: e.id, name: e.name, args: e.args }] }));
          }
          else if (e.type === "tool_result")
            update((m) => ({ ...m, tools: (m.tools ?? []).map((t) => (t.id === e.id ? { ...t, ok: e.ok, summary: e.summary } : t)) }));
          else if (e.type === "navigate") goTo = e.path;
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
      // La page affichée reflète les modifications faites par l'assistant
      if (wrote) router.refresh();
      // Page demandée par l'assistant (ouvrir_page), une fois la réponse terminée
      if (goTo && !ctrl.signal.aborted) {
        // Depuis la page Assistant, la conversation continue dans la fenêtre flottante
        if (!compact)
          try {
            sessionStorage.setItem(CHAT_OPEN_KEY, "1");
          } catch {}
        router.push(goTo);
      }
    }
  };

  return (
    <div className={compact ? "flex h-full min-h-0 flex-col" : "grid gap-4"}>
      {compact && (
        <button
          type="button"
          className="self-start px-4 pt-1 text-xs text-muted underline underline-offset-4 hover:text-ink"
          aria-expanded={showOptions}
          onClick={() => setShowOptions((v) => !v)}
        >
          {showOptions ? "Masquer les réglages" : "Réglages"}
        </button>
      )}
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-sm ${compact ? "px-4 py-2" : ""} ${showOptions ? "" : "hidden"}`}>
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

      <div className={compact ? "grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-4 py-3" : "grid gap-4"} aria-live="polite">
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
            <div key={i} className="grid max-w-[85%] justify-items-end gap-1.5 justify-self-end">
              {(m.pieces?.length ?? 0) > 0 && (
                <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Pièces jointes">
                  {m.pieces!.map((p) => (
                    <li key={p.id}>
                      <a href={`/api/assistant/pieces/${p.id}`} target="_blank" rel="noopener noreferrer" title={p.name}>
                        {p.type.startsWith("image/") && p.type !== "image/heic" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/assistant/pieces/${p.id}`} alt={p.name} className="size-20 rounded-lg border border-line object-cover" />
                        ) : (
                          <span className="block max-w-48 truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-bold">
                            📄 {p.name}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <div className="rounded-2xl rounded-br-sm bg-moss px-4 py-2 whitespace-pre-wrap text-surface">{m.text}</div>}
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
        className={
          compact
            ? "grid gap-2 border-t border-line bg-surface p-2 data-[drop]:ring-2 data-[drop]:ring-moss data-[drop]:ring-inset"
            : "sticky bottom-20 grid gap-2 rounded-xl border border-line bg-surface p-2 shadow-sm sm:bottom-4 data-[drop]:ring-2 data-[drop]:ring-moss"
        }
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragOver(false);
          addFiles([...e.dataTransfer.files]);
        }}
        data-drop={dragOver ? "1" : undefined}
      >
        {pending.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-1" aria-label="Pièces à envoyer">
            {pending.map((p) => (
              <li
                key={p.key}
                className={`flex max-w-full items-center gap-1.5 rounded-lg border py-1 pr-1 pl-1.5 text-xs ${p.error ? "border-brick bg-brick-soft text-brick" : "border-line bg-paper"}`}
              >
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.preview} alt="" className="size-8 rounded object-cover" />
                ) : (
                  <span aria-hidden>📄</span>
                )}
                <span className="max-w-40 truncate" title={p.name}>
                  {p.name}
                </span>
                <span className="text-muted">{p.error ?? (p.piece ? fmtSize(p.piece.size) : "envoi…")}</span>
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded hover:bg-surface"
                  aria-label={`Retirer ${p.name}`}
                  onClick={() => removePending(p.key)}
                >
                  <Close size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="chat-input" className="sr-only">
          Message pour l&apos;assistant
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="min-h-12 resize-none bg-transparent px-2 py-1 outline-none"
          rows={2}
          maxLength={4000}
          placeholder="Écris ta demande, colle ou joins une image ou un document… (Entrée pour envoyer)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            // Image ou fichier collé (capture d'écran, fichier copié dans l'explorateur)
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={`image/*,${ACCEPT_ATTR}`}
            className="hidden"
            aria-label="Joindre des fichiers"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="mr-auto grid size-9 place-items-center rounded-md text-muted hover:bg-moss-soft hover:text-ink disabled:opacity-40"
            aria-label="Joindre une image ou un document"
            title="Joindre une image ou un document (ou coller, ou glisser ici)"
            disabled={pending.length >= PIECES_MAX}
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={18} aria-hidden />
          </button>
          {busy ? (
            <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => abortRef.current?.abort()}>
              Arrêter
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary min-h-9 px-4 text-sm"
            disabled={busy || uploading || (!input.trim() && !pending.some((p) => p.piece))}
          >
            {busy ? "…" : uploading ? "Envoi des fichiers…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}
