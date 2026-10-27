// Outils de texte enrichi utilisables côté navigateur comme côté serveur (sans dépendance).

/** Une description enregistrée avant l'éditeur est du texte brut ; les nouvelles sont du HTML. */
export function isHtml(value: string): boolean {
  return /^\s*<(p|h[1-6]|ul|ol|blockquote|pre|hr|div)[\s>/]/i.test(value);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texte brut → paragraphes HTML (lignes vides = nouveau paragraphe, retour à la ligne = <br>). */
export function plainToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Contenu de départ de l'éditeur pour une valeur enregistrée (HTML ou ancien texte brut). */
export function toEditorHtml(value: string | null | undefined): string {
  if (!value) return "";
  return isHtml(value) ? value : plainToHtml(value);
}
