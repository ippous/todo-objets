import "server-only";
import sanitizeHtml from "sanitize-html";
import { isHtml, plainToHtml } from "./rich-text-shared";

// Une balise refusée devient « x-retire », absente de la liste : elle disparaît.
const tag = (tagName: string, attribs: sanitizeHtml.Attributes = {}): sanitizeHtml.Tag => ({ tagName, attribs });

// Seules les balises produites par l'éditeur sont conservées ; tout le reste
// (scripts, styles, attributs d'évènements, liens javascript:…) est retiré.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a", "span", "img", "label", "input", "div"],
  // span[data-commande] : commande @@nom recalculée à chaque affichage ;
  // ul/li[data-type] : cases à cocher ; img : photo de Carnet insérée dans le texte
  allowedAttributes: {
    a: ["href", "target", "rel"],
    ol: ["start"],
    span: ["data-commande"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    img: ["src", "alt", "data-photo"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  transformTags: {
    b: "strong",
    i: "em",
    span: (tagName, attribs) => {
      const name = (attribs["data-commande"] ?? "").toLowerCase();
      const keep: sanitizeHtml.Attributes = /^[a-z0-9_-]{1,40}$/.test(name) ? { "data-commande": name } : {};
      return { tagName, attribs: keep };
    },
    ul: (tagName, attribs) => tag(tagName, attribs["data-type"] === "taskList" ? { "data-type": "taskList" } : {}),
    li: (tagName, attribs) =>
      tag(
        tagName,
        attribs["data-type"] === "taskItem"
          ? { "data-type": "taskItem", "data-checked": attribs["data-checked"] === "true" ? "true" : "false" }
          : {},
      ),
    // Seules les cases à cocher sont acceptées comme champs
    input: (tagName, attribs) =>
      attribs.type === "checkbox"
        ? tag(tagName, { type: "checkbox", ...(attribs.checked !== undefined ? { checked: "checked" } : {}) })
        : tag("x-retire"),
    // Seules les photos de Carnet (servies après contrôle de la session) sont acceptées
    img: (tagName, attribs) => {
      const m = /^\/api\/photos\/([0-9a-f-]{36})(?:\?v=1)?$/i.exec(attribs.src ?? "");
      if (!m) return tag("x-retire");
      const id = m[1].toLowerCase();
      return tag(tagName, { src: `/api/photos/${id}`, "data-photo": id, alt: (attribs.alt ?? "").slice(0, 200) });
    },
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
  },
};

export const RICH_TEXT_MAX = 50_000;

/** Nettoie le HTML envoyé par l'éditeur. Renvoie null si le contenu est vide. */
export function sanitizeRichText(raw: string | null): string | null {
  if (!raw) return null;
  const html = sanitizeHtml(isHtml(raw) ? raw : plainToHtml(raw), OPTIONS).trim();
  const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  return text || /<hr/.test(html) ? html : null;
}

/** HTML sûr à afficher pour une description enregistrée (y compris l'ancien texte brut). */
export function renderRichText(value: string | null): string {
  if (!value) return "";
  return sanitizeHtml(isHtml(value) ? value : plainToHtml(value), OPTIONS);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Texte lisible (façon Markdown léger) à partir d'une description enregistrée — pour le MCP. */
export function richTextToPlain(value: string | null): string {
  if (!value) return "";
  const html = renderRichText(value);
  return html
    .replace(/<h2[^>]*>/g, "\n## ")
    .replace(/<h3[^>]*>/g, "\n### ")
    .replace(/<li data-type="taskItem" data-checked="(true|false)">/g, (_, c) => (c === "true" ? "\n- [x] " : "\n- [ ] "))
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<img [^>]*data-photo="([0-9a-f-]+)"[^>]*>/g, "[image]")
    .replace(/<blockquote[^>]*>/g, "\n> ")
    .replace(/<hr\s*\/?>/g, "\n---\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<(strong|b)>/g, "**")
    .replace(/<\/(strong|b)>/g, "**")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, (_, href, text) => (text === href ? href : `${text} (${href})`))
    .replace(/<\/(p|h2|h3|ul|ol|blockquote|pre)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineMd(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Description envoyée par un assistant (MCP) : Markdown simple (titres ##, listes -, 1., citations >,
 * **gras**, *italique*, ~~barré~~, `code`, [lien](https://…), ---) ou HTML ; renvoie le HTML nettoyé.
 */
export function markdownToRichText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  if (isHtml(text)) return sanitizeRichText(text);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      flushPara();
      closeList();
      out.push(m[1].length <= 2 ? `<h2>${inlineMd(m[2])}</h2>` : `<h3>${inlineMd(m[2])}</h3>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const kind = /^\s*\d/.test(line) ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li><p>${inlineMd(m[1])}</p></li>`);
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<blockquote><p>${inlineMd(m[1])}</p></blockquote>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return sanitizeRichText(out.join(""));
}
