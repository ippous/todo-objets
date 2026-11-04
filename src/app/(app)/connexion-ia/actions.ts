"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { createPersonalToken, revokeAccess, type Rights } from "@/lib/oauth";
import { requireUser } from "@/lib/session";

export type CreateTokenState = { token?: string; name?: string; rights?: Rights; error?: string };

export async function createTokenAction(_: CreateTokenState, fd: FormData): Promise<CreateTokenState> {
  const user = await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Donne un nom au jeton (ex. « Claude Desktop sur le PC »)." };
  const droits = fd.get("droits");
  const rights: Rights = droits === "suppression" ? "suppression" : droits === "ecriture" ? "ecriture" : "lecture";
  const { token, row } = await createPersonalToken(getDb(), user.id, name, rights !== "lecture", rights === "suppression");
  revalidatePath("/connexion-ia");
  return { token, name: row.name, rights };
}

export async function revokeAccessAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Identifiant invalide" };
  const ok = await revokeAccess(getDb(), user.id, id);
  revalidatePath("/connexion-ia");
  return ok ? {} : { error: "Accès introuvable ou déjà retiré" };
}
