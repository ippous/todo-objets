import "server-only";
import sanitizeHtml from "sanitize-html";
import { isHtml, plainToHtml } from "./rich-text-shared";

// Seules les balises produites par l'éditeur sont conservées ; tout le reste
// (scripts, styles, attributs d'évènements, liens javascript:…) est retiré.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a"],
  allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    b: "strong",
    i: "em",
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
    .replace(/<li[^>]*>/g, "\n- ")
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
