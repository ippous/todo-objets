"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { AI_PROVIDERS, AiError, type AiProvider } from "@/lib/ai";
import { aiWriteCommand, createCommand, deleteCommand, listCommands, updateCommand } from "@/lib/commands";
import type { ActionState } from "@/lib/forms";
import { DomainError } from "@/lib/repo";
import { requireAdmin, requireUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(err: unknown): { error: string } {
  if (err instanceof DomainError || err instanceof AiError) return { error: err.message };
  console.error(err);
  return { error: "Une erreur est survenue. Réessaie dans un instant." };
}

const read = (fd: FormData) => ({
  name: String(fd.get("name") ?? ""),
  description: String(fd.get("description") ?? "") || null,
  code: String(fd.get("code") ?? ""),
});

/** Commandes disponibles dans l'éditeur (nom, description, code), pour tout utilisateur connecté. */
export async function listCommandsForEditorAction(): Promise<{ name: string; description: string | null; code: string }[]> {
  await requireUser();
  const rows = await listCommands(getDb());
  return rows.map((c) => ({ name: c.name, description: c.description, code: c.code }));
}

export async function createCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  let id: string;
  try {
    id = (await createCommand(getDb(), read(fd), me.id)).id;
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/commandes");
  redirect(`/commandes/${id}?enregistree=1`);
}

export async function updateCommandAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  try {
    if (!UUID.test(id)) throw new DomainError("Identifiant invalide");
    await updateCommand(getDb(), id, read(fd), me.id);
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/commandes");
  return { ok: true };
}

export async function deleteCommandAction(id: string): Promise<ActionState> {
  await requireAdmin();
  try {
    if (!UUID.test(id)) throw new DomainError("Identifiant invalide");
    await deleteCommand(getDb(), id);
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/commandes");
  redirect("/commandes");
}

/** Code JavaScript écrit ou corrigé par l'IA (non enregistré : il arrive dans l'éditeur de code). */
export async function aiWriteCommandAction(input: {
  name: string;
  request: string;
  code: string | null;
  error: string | null;
  provider: string | null;
}): Promise<{ code?: string; error?: string }> {
  await requireAdmin();
  try {
    const provider = (AI_PROVIDERS as readonly string[]).includes(input?.provider ?? "") ? (input.provider as AiProvider) : null;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const code = await aiWriteCommand(
      getDb(),
      {
        name: str(input?.name, 40),
        request: str(input?.request, 2000),
        code: str(input?.code, 20_000) || null,
        error: str(input?.error, 2000) || null,
      },
      provider,
    );
    return { code };
  } catch (err) {
    return fail(err);
  }
}
