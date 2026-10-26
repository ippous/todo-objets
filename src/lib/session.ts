import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { getUserByEmail } from "./repo";

/**
 * Utilisateur courant, relu en base à chaque requête : un accès retiré
 * ou un rôle modifié prend effet immédiatement.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const user = await getUserByEmail(getDb(), email);
  return user?.active ? user : null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
