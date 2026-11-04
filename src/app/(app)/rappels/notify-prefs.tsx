"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { deletePushDeviceAction, saveNotifyPrefsAction, sendTestReminderAction } from "@/app/reminder-actions";
import { FormError, Submit } from "@/components/submit";

type Device = { id: string; endpoint: string; label: string; since: string; lastSuccess: string | null };

/** Clé VAPID publique (base64url) → octets attendus par pushManager.subscribe. */
function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad/i.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function NotifyPrefs({
  email,
  notifyEmail,
  notifyPush,
  emailReady,
  pushKey,
  devices,
}: {
  email: string;
  notifyEmail: boolean;
  notifyPush: boolean;
  emailReady: boolean;
  pushKey: string | null;
  devices: Device[];
}) {
  const [state, action] = useActionState(saveNotifyPrefsAction, {});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  // Abonnement de l'appareil courant : null = pas encore vérifié
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [support, setSupport] = useState<"ok" | "absent" | "ios-installer" | "refuse">("ok");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setSupport(isIos() && !isStandalone() ? "ios-installer" : "absent");
        return;
      }
      if (Notification.permission === "denied" && !cancelled) setSupport("refuse");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) setCurrent(sub?.endpoint ?? null);
    })().catch(() => !cancelled && setSupport("absent"));
    return () => {
      cancelled = true;
    };
  }, []);

  const enableHere = () =>
    start(async () => {
      setMsg({});
      try {
        if (!pushKey) return;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setSupport("refuse");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) }));
        const r = await fetch("/api/rappels/abonnement", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Enregistrement refusé");
        setCurrent(sub.endpoint);
        setMsg({ ok: "Notifications activées sur cet appareil." });
        location.reload();
      } catch (err) {
        setMsg({ error: err instanceof Error ? err.message : "Activation impossible" });
      }
    });

  const disableHere = () =>
    start(async () => {
      setMsg({});
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/rappels/abonnement", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setCurrent(null);
      location.reload();
    });

  const test = () =>
    start(async () => {
      const r = await sendTestReminderAction();
      setMsg(r.error ? { error: r.error + (r.info ? ` (${r.info})` : "") } : { ok: r.info });
    });

  const hereRegistered = !!current && devices.some((d) => d.endpoint === current);

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-3 rounded-xl bg-surface p-4">
        <h2 className="text-lg font-bold">Recevoir les rappels</h2>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="email" defaultChecked={notifyEmail} className="mt-1 size-5 accent-moss" />
          <span>
            Par e-mail, à <strong>{email}</strong>
            {!emailReady && <span className="block text-sm text-ochre">L&apos;envoi d&apos;e-mails n&apos;est pas encore configuré sur le serveur.</span>}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="push" defaultChecked={notifyPush} className="mt-1 size-5 accent-moss" />
          <span>
            Par notification, sur les appareils activés ci-dessous (téléphone, PC)
            {!pushKey && <span className="block text-sm text-ochre">Les notifications ne sont pas encore configurées sur le serveur.</span>}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Submit className="btn btn-primary w-fit">Enregistrer</Submit>
          {state.ok && <span className="text-sm text-moss">Enregistré.</span>}
        </div>
        <FormError error={state.error} />
      </form>

      <section aria-labelledby="appareils" className="grid gap-3 rounded-xl bg-surface p-4">
        <h2 id="appareils" className="text-lg font-bold">
          Appareils qui reçoivent les notifications
        </h2>
        {pushKey && (
          <div className="grid gap-2">
            {support === "ios-installer" ? (
              <p className="text-sm text-muted">
                Sur iPhone, ajoute d&apos;abord Carnet à l&apos;écran d&apos;accueil (Partager › Sur l&apos;écran d&apos;accueil), ouvre-le
                depuis l&apos;icône, puis reviens sur cette page.
              </p>
            ) : support === "absent" ? (
              <p className="text-sm text-muted">Ce navigateur ne gère pas les notifications.</p>
            ) : support === "refuse" ? (
              <p className="text-sm text-brick">
                Les notifications de Carnet sont bloquées dans ce navigateur : autorise-les dans les réglages du site, puis recharge la page.
              </p>
            ) : hereRegistered ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-moss-soft px-2 py-0.5 text-sm font-bold text-moss">Activé sur cet appareil</span>
                <button type="button" className="btn btn-ghost min-h-9 px-3 text-sm" disabled={pending} onClick={disableHere}>
                  Désactiver ici
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-primary w-fit" disabled={pending || current === undefined} onClick={enableHere}>
                Activer sur cet appareil
              </button>
            )}
          </div>
        )}
        <ul className="grid">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 border-b border-line py-2 last:border-b-0">
              <span className="font-bold">{d.label}</span>
              {d.endpoint === current && <span className="text-sm text-moss">cet appareil</span>}
              <span className="flex-1 text-sm text-muted">
                depuis le {d.since}
                {d.lastSuccess && ` · dernier envoi le ${d.lastSuccess}`}
              </span>
              <button
                type="button"
                className="btn btn-ghost min-h-9 px-3 text-sm text-brick"
                disabled={pending}
                onClick={() => start(async () => void (await deletePushDeviceAction(d.id)))}
              >
                Retirer
              </button>
            </li>
          ))}
          {devices.length === 0 && <li className="text-sm text-muted">Aucun appareil pour l&apos;instant.</li>}
        </ul>
      </section>

      <div className="grid gap-2">
        <button type="button" className="btn btn-ghost w-fit" disabled={pending} onClick={test}>
          {pending ? "Envoi…" : "M'envoyer un rappel d'essai"}
        </button>
        {msg.ok && <p className="text-sm text-moss">{msg.ok}</p>}
        <FormError error={msg.error} />
      </div>
    </div>
  );
}
