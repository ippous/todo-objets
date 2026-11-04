"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { type ActionState, str } from "@/lib/forms";
import { configuredSenders } from "@/lib/notify";
import {
  createReminderScheme,
  deletePushSubscription,
  deleteReminderScheme,
  DomainError,
  listPushSubscriptions,
  setDefaultScheme,
  setNotifyPrefs,
  updateReminderScheme,
} from "@/lib/reminder-repo";
import { parseOffsets } from "@/lib/reminders";
import { requireAdmin, requireUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function handle(err: unknown): ActionState {
  if (err instanceof DomainError) return { error: err.message };
  console.error(err);
  return { error: "Une erreur est survenue. Réessaie dans un instant." };
}

// ---------- Préférences de chacun ----------

export async function saveNotifyPrefsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await setNotifyPrefs(getDb(), user.id, { email: str(fd, "email") === "on", push: str(fd, "push") === "on" });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/rappels");
  return { ok: true };
}

export async function deletePushDeviceAction(id: string): Promise<ActionState> {
  const user = await requireUser();
  if (!UUID.test(id)) return { error: "Identifiant invalide" };
  await deletePushSubscription(getDb(), user.id, id);
  revalidatePath("/rappels");
  return { ok: true };
}

/** Envoie un rappel d'essai à l'utilisateur courant, sur ses canaux actifs. */
export async function sendTestReminderAction(): Promise<ActionState & { info?: string }> {
  const user = await requireUser();
  const senders = configuredSenders();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const msg = {
    title: "Rappel d'essai · Carnet",
    body: "Les rappels arrivent bien ici.",
    url: `${origin}/rappels`,
    tag: "essai",
  };
  const done: string[] = [];
  const errors: string[] = [];
  if (user.notifyEmail && senders.email) {
    try {
      await senders.email({ email: user.email, name: user.name }, msg);
      done.push(`e-mail à ${user.email}`);
    } catch (err) {
      errors.push(`e-mail : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (user.notifyPush && senders.push) {
    const db = getDb();
    for (const sub of await listPushSubscriptions(db, user.id)) {
      try {
        const r = await senders.push(sub, msg);
        if (r === "gone") await deletePushSubscription(db, user.id, sub.id);
        else done.push(`notification sur ${sub.label}`);
      } catch (err) {
        errors.push(`${sub.label} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  revalidatePath("/rappels");
  if (errors.length) return { error: `Échec — ${errors.join(" ; ")}`, info: done.length ? `Envoyé : ${done.join(", ")}` : undefined };
  if (!done.length) return { error: "Aucun canal actif : active l'e-mail ou les notifications sur un appareil." };
  return { ok: true, info: `Envoyé : ${done.join(", ")}` };
}

// ---------- Schémas (administrateurs) ----------

function readScheme(fd: FormData) {
  const parsed = parseOffsets(str(fd, "offsets"));
  if ("error" in parsed) throw new DomainError(parsed.error);
  return { name: str(fd, "name"), offsets: parsed.offsets };
}

export async function createSchemeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    await createReminderScheme(getDb(), { ...readScheme(fd), isDefault: str(fd, "isDefault") === "on" });
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs/rappels");
  return { ok: true };
}

export async function updateSchemeAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!UUID.test(id)) return { error: "Identifiant invalide" };
  try {
    await updateReminderScheme(getDb(), id, readScheme(fd));
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs/rappels");
  return { ok: true };
}

export async function setDefaultSchemeAction(id: string | null): Promise<ActionState> {
  await requireAdmin();
  if (id && !UUID.test(id)) return { error: "Identifiant invalide" };
  try {
    await setDefaultScheme(getDb(), id);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs/rappels");
  return { ok: true };
}

export async function deleteSchemeAction(id: string): Promise<ActionState> {
  await requireAdmin();
  if (!UUID.test(id)) return { error: "Identifiant invalide" };
  try {
    await deleteReminderScheme(getDb(), id);
  } catch (err) {
    return handle(err);
  }
  revalidatePath("/utilisateurs/rappels");
  return { ok: true };
}
