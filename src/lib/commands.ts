import "server-only";
// Commandes de saisie ($$nom, @@nom) : stockage, validation, et aide IA pour écrire leur JavaScript.
import { asc, eq, ne, and, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { commands, type Command } from "@/db/schema";
import { aiComplete, resolveProvider, type AiProvider } from "./ai";
import { DomainError } from "./repo";

export const COMMAND_CODE_MAX = 20_000;
/** Nom utilisable après $$ ou @@ : lettres, chiffres, tiret et souligné. */
export const COMMAND_NAME = /^[a-z0-9_-]{1,40}$/;

export type CommandInput = { name: string; description: string | null; code: string };

function clean(input: CommandInput): CommandInput {
  const name = input.name.trim().toLowerCase();
  if (!COMMAND_NAME.test(name)) {
    throw new DomainError("Nom invalide : lettres minuscules sans accent, chiffres, - ou _ (40 caractères au plus)");
  }
  const code = input.code.replace(/\r\n/g, "\n");
  if (!code.trim()) throw new DomainError("Le code JavaScript est vide");
  if (code.length > COMMAND_CODE_MAX) throw new DomainError("Code trop long");
  const description = input.description?.trim().slice(0, 300) || null;
  return { name, description, code };
}

async function assertFree(db: Db, name: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: commands.id })
    .from(commands)
    .where(and(sql`lower(${commands.name}) = ${name}`, exceptId ? ne(commands.id, exceptId) : undefined));
  if (dup) throw new DomainError(`La commande « ${name} » existe déjà`);
}

export async function listCommands(db: Db): Promise<Command[]> {
  return db.select().from(commands).orderBy(asc(commands.name));
}

export async function getCommand(db: Db, id: string): Promise<Command | undefined> {
  const [row] = await db.select().from(commands).where(eq(commands.id, id));
  return row;
}

export async function createCommand(db: Db, input: CommandInput, userId?: string): Promise<Command> {
  const data = clean(input);
  await assertFree(db, data.name);
  const [row] = await db
    .insert(commands)
    .values({ ...data, updatedById: userId ?? null })
    .returning();
  return row;
}

export async function updateCommand(db: Db, id: string, input: CommandInput, userId?: string): Promise<void> {
  const data = clean(input);
  await assertFree(db, data.name, id);
  const [row] = await db
    .update(commands)
    .set({ ...data, updatedById: userId ?? null, updatedAt: new Date() })
    .where(eq(commands.id, id))
    .returning({ id: commands.id });
  if (!row) throw new DomainError("Commande introuvable");
}

export async function deleteCommand(db: Db, id: string): Promise<void> {
  const [row] = await db.delete(commands).where(eq(commands.id, id)).returning({ id: commands.id });
  if (!row) throw new DomainError("Commande introuvable");
}

/** Ce que voit le code d'une commande : à rappeler à l'IA et dans l'aide de la page. */
export const COMMAND_RUNTIME_DOC =
  "Le code est le corps d'une fonction JavaScript asynchrone (on peut utiliser await) qui s'exécute dans le navigateur, " +
  "dans un Web Worker isolé : pas de DOM (document, window), pas de réseau (fetch, XMLHttpRequest, importScripts indisponibles), " +
  "2 secondes au plus. Elle reçoit `ctx` : { maintenant: date ISO de l'exécution, titre: titre de la tâche ou de l'objet en cours " +
  "(ou null), objet: nom de l'objet concerné (ou null), commande: nom de la commande }. " +
  "Elle doit renvoyer (return) le texte à afficher : une chaîne ou un nombre, en texte brut, sans HTML.";

/** Code proposé par l'IA : nouvelle commande d'après une demande, ou correction du code actuel. */
export async function aiWriteCommand(
  db: Db,
  input: { name: string; request: string; code?: string | null; error?: string | null },
  provider?: AiProvider | null,
): Promise<string> {
  if (!input.request.trim() && !input.code?.trim()) throw new DomainError("Décris ce que doit faire la commande");
  const target = await resolveProvider(db, provider);
  const parts = [
    `Commande « ${input.name || "sans nom"} » de Carnet, une appli de tâches en français (fuseau Europe/Paris).`,
    COMMAND_RUNTIME_DOC,
    input.request.trim() ? `Ce que doit faire la commande :\n${input.request.trim()}` : null,
    input.code?.trim() ? `Code actuel :\n${input.code}` : null,
    input.error?.trim() ? `Dernier test :\n${input.error.trim()}` : null,
    input.code?.trim()
      ? "Corrige ou améliore ce code pour qu'il fasse ce qui est demandé, en le gardant court et lisible."
      : "Écris ce code, court et lisible.",
    "Réponds uniquement avec le corps de la fonction (sans la déclaration de fonction ni bloc ```), commentaires en français bienvenus.",
  ];
  const reply = await aiComplete(target, {
    system: "Tu écris du JavaScript moderne, sûr et sans dépendance.",
    prompt: parts.filter(Boolean).join("\n\n"),
    maxTokens: 2000,
  });
  const code = reply
    .replace(/^\s*```[a-z]*\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  if (!code) throw new DomainError("L'assistant IA n'a pas proposé de code");
  return code.slice(0, COMMAND_CODE_MAX);
}
