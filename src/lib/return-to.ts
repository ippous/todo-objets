/** Chemin de retour interne uniquement (évite les redirections vers un autre site). */
export function returnPath(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
