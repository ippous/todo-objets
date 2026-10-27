"use client";

// Éditeur de texte enrichi (WYSIWYG) pour les descriptions. Le HTML produit est
// envoyé dans un champ caché `name` et nettoyé côté serveur avant enregistrement.
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { useId, useState } from "react";
import { toEditorHtml } from "@/lib/rich-text-shared";

type Props = {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
};

export function RichTextEditor({ name, label, defaultValue, placeholder }: Props) {
  const labelId = useId();
  const [html, setHtml] = useState(() => toEditorHtml(defaultValue));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto", "tel"] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: html,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: "rich rich-editor",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.isEmpty ? "" : editor.getHTML()),
  });

  return (
    <div className="field">
      <span id={labelId}>{label}</span>
      <div className="grid">
        <Toolbar editor={editor} />
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          // Avant le chargement de l'éditeur : même hauteur, pour éviter un saut
          <div className="rich rich-editor text-muted" aria-hidden>
            …
          </div>
        )}
      </div>
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
    { label: "❝", title: "Citation", active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
    { label: "—", title: "Ligne de séparation", run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

function Toolbar({ editor }: { editor: Editor | null }) {
  const urlId = useId();
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
