"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { createAuthCode, OAuthError, validateAuthorize, type AuthorizeRequest } from "@/lib/oauth";
import { getCurrentUser } from "@/lib/session";

function readRequest(fd: FormData): AuthorizeRequest & { responseType: string; state: string } {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    clientId: s("client_id"),
    redirectUri: s("redirect_uri"),
    codeChallenge: s("code_challenge"),
    codeChallengeMethod: s("code_challenge_method"),
    scope: s("scope"),
    resource: s("resource") || null,
    responseType: s("response_type"),
    state: s("state"),
  };
}

function back(redirectUri: string, params: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

/** L'utilisateur accepte : code d'autorisation renvoyé à l'application. */
export async function approveAction(fd: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const req = readRequest(fd);
  const db = getDb();
  let target: string;
  try {
    await validateAuthorize(db, req); // revérifiée : le formulaire vient du navigateur
    const code = await createAuthCode(db, user.id, req, fd.get("ecriture") === "on");
    target = back(req.redirectUri, { code, state: req.state });
  } catch (err) {
    if (err instanceof OAuthError) redirect(`/oauth/autoriser?erreur=${encodeURIComponent(err.description)}`);
    throw err;
  }
  redirect(target);
}

/** L'utilisateur refuse. */
export async function denyAction(fd: FormData) {
  const req = readRequest(fd);
  try {
    await validateAuthorize(getDb(), req);
  } catch {
    redirect("/");
  }
  redirect(back(req.redirectUri, { error: "access_denied", error_description: "Accès refusé par l'utilisateur", state: req.state }));
}
