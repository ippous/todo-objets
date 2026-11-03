"use client";

// Éditeur de texte enrichi (WYSIWYG) pour les descriptions. Le HTML produit est
// envoyé dans un champ caché `name` et nettoyé côté serveur avant enregistrement.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { Placeholder } from "@tiptap/extensions";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { uploadPhoto, type PhotoTarget } from "@/lib/photo-upload";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { getCommands, runCommandCode, type CommandContext, type CommandDef } from "@/lib/command-runtime";
import { CommandNode } from "./command-node";
import { toEditorHtml } from "@/lib/rich-text-shared";

type Props = {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  /** Accès au contenu depuis l'extérieur (ex. remplacer la description par une proposition de l'IA). */
  apiRef?: RefObject<RichTextApi | null>;
  /** Contexte passé aux commandes $$ et @@ (titre, objet). */
  commandContext?: CommandContext;
  /** Où ranger les images insérées dans le texte (absent : pas d'images, ex. avant création). */
  images?: PhotoTarget;
  /** Appelé à chaque modification du contenu. */
  onChange?: () => void;
};

/** Saisie en cours après $$ (résultat inséré) ou @@ (recalculé à chaque affichage). */
type Trigger = { kind: "$$" | "@@"; query: string; from: number; to: number; left: number; top: number };

export type RichTextApi = { getHtml: () => string; setHtml: (html: string) => void };

export function RichTextEditor({ name, label, defaultValue, placeholder, apiRef, commandContext, images, onChange }: Props) {
  const labelId = useId();
  const [html, setHtml] = useState(() => toEditorHtml(defaultValue));
  const baseCtxRef = useRef<CommandContext>(commandContext ?? {});
  useEffect(() => {
    baseCtxRef.current = commandContext ?? {};
  }, [commandContext]);
  /** Contexte des commandes, lu au moment de l'exécution : titre et objet tels qu'ils sont saisis dans le formulaire. */
  const liveContext = (): CommandContext => {
    const base = baseCtxRef.current;
    const form = wrapRef.current?.closest("form");
    if (!form) return base;
    const value = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value?.trim() || null;
    const select = form.elements.namedItem("objectId") as HTMLSelectElement | null;
    const objet = select?.selectedOptions[0]?.value ? select.selectedOptions[0].text.replace(/^[\s└]+/, "") : null;
    const titre = value("title") ?? value("name") ?? base.titre ?? null;
    return { titre, objet: objet ?? (select ? base.objet : (value("name") ?? base.objet)) ?? null };
  };
  const ctxRef = useRef(liveContext);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    ctxRef.current = liveContext;
  });

  // Raccourcis de commandes : liste filtrée, choix au clavier ou à la souris
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [commands, setCommands] = useState<CommandDef[] | null>(null);
  const [active, setActive] = useState(0);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Trigger | null>(null);
  const matchesRef = useRef<CommandDef[]>([]);
  const activeRef = useRef(0);
  const chooseRef = useRef<(c: CommandDef) => void>(() => {});
  // Images : envoi puis insertion à l'endroit du curseur (bouton, collage ou glisser-déposer)
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const insertImagesRef = useRef<(files: File[], at?: number) => void>(() => {});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto", "tel"] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      // eslint-disable-next-line react-hooks/refs -- lu seulement à l'exécution d'une commande, pas au rendu
      CommandNode.configure({ context: () => ctxRef.current() }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: html,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: "rich rich-editor",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        insertImagesRef.current(files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertImagesRef.current(files, pos);
        return true;
      },
      handleKeyDown: (_view, event) => {
        const t = triggerRef.current;
        const list = matchesRef.current;
        if (!t) return false;
        if (event.key === "Escape") {
          setTrigger(null);
          return true;
        }
        if (!list.length) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const n = (activeRef.current + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length;
          activeRef.current = n;
          setActive(n);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          chooseRef.current(list[Math.min(activeRef.current, list.length - 1)]);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setHtml(editor.isEmpty ? "" : editor.getHTML());
      onChangeRef.current?.();
    },
    onTransaction: ({ editor }) => {
      // Cherche « $$nom » ou « @@nom » juste avant le curseur
      const { selection } = editor.state;
      let next: Trigger | null = null;
      if (selection.empty) {
        const $from = selection.$from;
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 50), $from.parentOffset, undefined, "\ufffc");
        const m = /(\$\$|@@)([a-z0-9_-]{0,40})$/i.exec(before);
        if (m) {
          const coords = editor.view.coordsAtPos($from.pos);
          const box = wrapRef.current?.getBoundingClientRect();
          next = {
            kind: m[1] as Trigger["kind"],
            query: m[2].toLowerCase(),
            from: $from.pos - m[0].length,
            to: $from.pos,
            // Liste de 18 rem (288 px) gardée dans la largeur de l'éditeur
            left: box ? Math.max(0, Math.min(coords.left - box.left, box.width - 296)) : 0,
            top: box ? coords.bottom - box.top + 4 : 0,
          };
        }
      }
      const prev = triggerRef.current;
      if (!next && !prev) return;
      if (next && prev && next.kind === prev.kind && next.query === prev.query && next.from === prev.from) return;
      triggerRef.current = next;
      activeRef.current = 0;
      setActive(0);
      setTrigger(next);
    },
  });

  // Liste des commandes, chargée à la première utilisation
  useEffect(() => {
    if (trigger && !commands) void getCommands().then(setCommands);
  }, [trigger, commands]);

  const matches = trigger && commands ? commands.filter((c) => c.name.startsWith(trigger.query)) : [];
  useEffect(() => {
    matchesRef.current = matches;
  });

  const choose = (c: CommandDef) => {
    const t = triggerRef.current;
    if (!editor || !t) return;
    triggerRef.current = null;
    setTrigger(null);
    setCmdError(null);
    if (t.kind === "@@") {
      editor.chain().focus().insertContentAt({ from: t.from, to: t.to }, [{ type: "commande", attrs: { name: c.name } }, { type: "text", text: " " }]).run();
      return;
    }
    // $$ : le résultat remplace le raccourci, une fois pour toutes
    void runCommandCode(c.code, c.name, ctxRef.current()).then((r) => {
      const typed = editor.state.doc.textBetween(t.from, Math.min(t.to, editor.state.doc.content.size), undefined, "\ufffc");
      if (!typed.startsWith("$$")) return; // le texte a bougé entre-temps
      if (!r.ok) {
        setCmdError(`$$${c.name} : ${r.error}`);
        return;
      }
      const chain = editor.chain().focus().deleteRange({ from: t.from, to: t.to });
      (r.value ? chain.insertContentAt(t.from, { type: "text", text: r.value }) : chain).run();
    });
  };
  useEffect(() => {
    chooseRef.current = choose;
  });

  const insertImages = async (files: File[], at?: number) => {
    if (!editor) return;
    if (!images) {
      setImageStatus("Enregistre d'abord pour pouvoir ajouter des images.");
      return;
    }
    let pos = at;
    for (const [i, file] of files.entries()) {
      setImageStatus(`Envoi de l'image ${i + 1} sur ${files.length}…`);
      try {
        const id = await uploadPhoto(file, { ...images, inline: true });
        const node = { type: "image", attrs: { src: `/api/photos/${id}`, alt: file.name.replace(/\.[a-z0-9]+$/i, "") } };
        if (pos === undefined) editor.chain().focus().insertContent(node).run();
        else {
          editor.chain().focus().insertContentAt(pos, node).run();
          pos = undefined;
        }
      } catch (err) {
        setImageStatus((err as Error).message || "L'envoi a échoué");
        return;
      }
    }
    setImageStatus(null);
  };
  useEffect(() => {
    insertImagesRef.current = (files, at) => void insertImages(files, at);
  });

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      getHtml: () => (editor ? (editor.isEmpty ? "" : editor.getHTML()) : html),
      setHtml: (next) => {
        if (editor) editor.commands.setContent(next, { emitUpdate: true });
        else setHtml(next);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, editor, html]);

  return (
    <div className="field">
      <span id={labelId}>{label}</span>
      <div className="relative grid" ref={wrapRef}>
        <Toolbar editor={editor} onImages={images ? (files) => void insertImages(files) : undefined} />
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          // Avant le chargement de l'éditeur : même hauteur, pour éviter un saut
          <div className="rich rich-editor text-muted" aria-hidden>
            …
          </div>
        )}
        {trigger && (
          <div
            role="listbox"
            aria-label={trigger.kind === "$$" ? "Commandes : résultat inséré" : "Commandes : recalculées à chaque affichage"}
            className="absolute z-20 grid max-h-64 w-72 max-w-[calc(100%-1rem)] overflow-auto rounded-lg border border-line bg-surface py-1 text-sm shadow-lg"
            style={{ left: trigger.left, top: trigger.top }}
          >
            <p className="px-3 pb-1 text-xs text-muted">
              {trigger.kind === "$$" ? "$$ insère le résultat" : "@@ recalcule à chaque affichage"} · Entrée pour choisir
            </p>
            {!commands && <p className="px-3 py-1 text-muted">Chargement…</p>}
            {commands && matches.length === 0 && (
              <p className="px-3 py-1 text-muted">
                Aucune commande « {trigger.query} ».{" "}
                <Link href="/commandes" target="_blank" className="text-moss underline-offset-4 hover:underline">
                  Gérer les commandes
                </Link>
              </p>
            )}
            {matches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === active}
                className={`grid px-3 py-1.5 text-left ${i === active ? "bg-moss-soft" : "hover:bg-paper"}`}
                onMouseDown={(e) => {
                  e.preventDefault(); // garde le focus dans l'éditeur
                  choose(c);
                }}
              >
                <span className="font-bold text-moss">
                  {trigger.kind}
                  {c.name}
                </span>
                {c.description && <span className="text-muted">{c.description}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Raccourcis : <span className="font-bold">$$commande</span> insère son résultat,{" "}
        <span className="font-bold">@@commande</span> le recalcule à chaque affichage ·{" "}
        <Link href="/commandes" target="_blank" className="text-moss underline-offset-4 hover:underline">
          Commandes
        </Link>
      </p>
      {imageStatus && (
        <p role="status" className="text-sm text-muted">
          {imageStatus}
        </p>
      )}
      {cmdError && (
        <p role="alert" className="text-sm text-brick">
          {cmdError}
        </p>
      )}
      <input type="hidden" name={name} value={html} />
    </div>
  );
}

type Btn = { label: string; title: string; active?: (e: Editor) => boolean; run: (e: Editor) => void; className?: string };

const GROUPS: Btn[][] = [
  [
    { label: "G", title: "Gras (Ctrl+B)", className: "font-bold", active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { label: "I", title: "Italique (Ctrl+I)", className: "italic", active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: "S", title: "Souligné (Ctrl+U)", className: "underline", active: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
    { label: "B", title: "Barré", className: "line-through", active: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  ],
  [
    { label: "T1", title: "Titre de section", active: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "T2", title: "Sous-titre de section", active: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: "•", title: "Liste à puces", active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: "1.", title: "Liste numérotée", active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: "☑", title: "Cases à cocher", active: (e) => e.isActive("taskList"), run: (e) => e.chain().focus().toggleTaskList().run() },
    { label: "❝", title: "Citation", active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
    { label: "—", title: "Ligne de séparation", run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

function Toolbar({ editor, onImages }: { editor: Editor | null; onImages?: (files: File[]) => void }) {
  const urlId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");

  // Recalcule l'état des boutons à chaque changement de sélection
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            active: GROUPS.flat().map((b) => b.active?.(e) ?? false),
            link: e.isActive("link"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  const openLink = () => {
    if (!editor) return;
    setUrl((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!editor) return;
    const raw = url.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!raw) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}` }).run();
    setLinkOpen(false);
  };

  let i = 0;
  const btn =
    "grid min-h-9 min-w-9 place-items-center rounded-md px-2 text-sm text-ink hover:bg-moss-soft disabled:opacity-40 aria-pressed:bg-moss aria-pressed:text-surface";

  return (
    <div className="grid rounded-t-lg border border-line bg-paper">
      <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap items-center gap-1 p-1">
        {GROUPS.map((group, g) => (
          <div key={g} className="flex gap-0.5 border-r border-line pr-1 last:border-r-0">
            {group.map((b) => {
              const k = i++;
              return (
                <button
                  key={b.title}
                  type="button"
                  title={b.title}
                  aria-label={b.title}
                  aria-pressed={b.active ? Boolean(state?.active[k]) : undefined}
                  disabled={!editor}
                  className={`${btn} ${b.className ?? ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor && b.run(editor)}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        ))}
        <div className="flex gap-0.5 border-r border-line pr-1">
          <button
            type="button"
            title="Lien"
            aria-label="Lien"
            aria-pressed={Boolean(state?.link)}
            aria-expanded={linkOpen}
            disabled={!editor}
            className={btn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (linkOpen ? setLinkOpen(false) : openLink())}
          >
            🔗
          </button>
          {onImages && (
            <>
              <button
                type="button"
                title="Image"
                aria-label="Insérer une image"
                disabled={!editor}
                className={btn}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fileInput.current?.click()}
              >
                🖼
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                aria-label="Images à insérer"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) onImages(files);
                }}
              />
            </>
          )}
        </div>
        <div className="flex gap-0.5">
          <button type="button" title="Annuler (Ctrl+Z)" aria-label="Annuler la modification" disabled={!state?.canUndo} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().undo().run()}>
            ↶
          </button>
          <button type="button" title="Rétablir (Ctrl+Y)" aria-label="Rétablir la modification" disabled={!state?.canRedo} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().redo().run()}>
            ↷
          </button>
        </div>
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-2">
          <label className="sr-only" htmlFor={urlId}>
            Adresse du lien
          </label>
          <input
            id={urlId}
            className="input min-h-9 flex-1 py-1 text-sm"
            placeholder="https://… (vide pour retirer le lien)"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
              }
            }}
          />
          <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={applyLink}>
            {url.trim() ? "Appliquer" : "Retirer le lien"}
          </button>
          <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" onClick={() => setLinkOpen(false)}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}
