import { describe, expect, it } from "vitest";
import { renderRichText, sanitizeRichText } from "@/lib/rich-text";
import { isHtml, plainToHtml, toEditorHtml } from "@/lib/rich-text-shared";

describe("texte enrichi", () => {
  it("garde la mise en forme de l'éditeur", () => {
    const html =
      "<h2>Accès</h2><p><strong>Gras</strong> <em>ital</em> <u>souligné</u> <s>barré</s></p><ul><li><p>un</p></li></ul><ol start=\"3\"><li><p>trois</p></li></ol><blockquote><p>cit</p></blockquote>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("retire scripts, styles, évènements et liens dangereux", () => {
    const out = sanitizeRichText(
      '<p onclick="x()" style="color:red">ok<script>alert(1)</script><img src=x onerror=alert(1)></p><a href="javascript:alert(1)">bad</a><iframe src="https://x"></iframe>',
    );
    // Le lien perd son adresse dangereuse mais garde son texte
    expect(out).toBe('<p>ok</p><a target="_blank" rel="noopener noreferrer nofollow">bad</a>');
  });

  it("force l'ouverture des liens dans un nouvel onglet, sans référent", () => {
    expect(sanitizeRichText('<p><a href="https://exemple.fr" target="_self">lien</a></p>')).toBe(
      '<p><a href="https://exemple.fr" target="_blank" rel="noopener noreferrer nofollow">lien</a></p>',
    );
  });

  it("considère un contenu vide comme absent", () => {
    expect(sanitizeRichText("<p></p>")).toBeNull();
    expect(sanitizeRichText("<p>   </p><p><br></p>")).toBeNull();
    expect(sanitizeRichText(null)).toBeNull();
  });

  it("convertit l'ancien texte brut en paragraphes, sans interpréter le HTML", () => {
    expect(isHtml("Surface : 2 ha")).toBe(false);
    expect(plainToHtml("Ligne 1\nLigne 2\n\nParagraphe <b>2</b>")).toBe(
      "<p>Ligne 1<br>Ligne 2</p><p>Paragraphe &lt;b&gt;2&lt;/b&gt;</p>",
    );
    expect(toEditorHtml("Surface : 2 ha 77 a 60 ca (27 760 m²)")).toBe("<p>Surface : 2 ha 77 a 60 ca (27 760 m²)</p>");
    expect(renderRichText("a < b")).toBe("<p>a &lt; b</p>");
    expect(sanitizeRichText("texte simple")).toBe("<p>texte simple</p>");
  });
});

describe("texte pour le MCP", () => {
  it("convertit le HTML en texte lisible", async () => {
    const { richTextToPlain } = await import("@/lib/rich-text");
    expect(
      richTextToPlain(
        '<h2>Accès</h2><p>Portail, <strong>code 1234</strong> &amp; clé</p><ul><li><p>un</p></li><li><p>deux</p></li></ul><p><a href="https://a.fr">notice</a></p>',
      ),
    ).toBe("## Accès\nPortail, **code 1234** & clé\n\n- un\n\n- deux\n\nnotice (https://a.fr)");
    expect(richTextToPlain("Surface : 2 ha")).toBe("Surface : 2 ha");
    expect(richTextToPlain(null)).toBe("");
  });
});

describe("Markdown envoyé par un assistant", () => {
  it("convertit le Markdown simple en texte enrichi nettoyé", async () => {
    const { markdownToRichText, richTextToPlain } = await import("@/lib/rich-text");
    const html = markdownToRichText(
      "## Accès\nPortail **code 1234**, *à huiler*\n\n- clé chez le voisin\n- [notice](https://a.fr/n)\n\n1. un\n2. deux\n\n> attention <script>x</script>",
    )!;
    expect(html).toContain("<h2>Accès</h2>");
    expect(html).toContain("<strong>code 1234</strong>");
    expect(html).toContain("<em>à huiler</em>");
    expect(html).toContain("<ul><li><p>clé chez le voisin</p></li>");
    expect(html).toContain('<a href="https://a.fr/n" target="_blank" rel="noopener noreferrer nofollow">notice</a>');
    expect(html).toContain("<ol><li><p>un</p></li><li><p>deux</p></li></ol>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(richTextToPlain(html)).toContain("## Accès");
    expect(markdownToRichText("  ")).toBeNull();
    expect(markdownToRichText("<p>déjà <strong>HTML</strong></p>")).toBe("<p>déjà <strong>HTML</strong></p>");
  });
});
