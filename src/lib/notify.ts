import "server-only";
import nodemailer from "nodemailer";
import webpush from "web-push";
import type { ReminderMessage, Senders } from "./reminder-repo";

// ---------- E-mail (SMTP) ----------
// SMTP_HOST, SMTP_PORT (465 par défaut), SMTP_USER, SMTP_PASSWORD, MAIL_FROM

export const emailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);

let transport: nodemailer.Transporter | null = null;
function mailer() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendEmail(to: { email: string; name: string }, msg: ReminderMessage) {
  const from = process.env.MAIL_FROM || `Carnet <${process.env.SMTP_USER}>`;
  const lines = msg.body.split("\n");
  await mailer().sendMail({
    from,
    to: { name: to.name, address: to.email },
    subject: msg.title,
    text: `${msg.body}\n\nOuvrir la tâche : ${msg.url}\n\n— Carnet (réglages des rappels : ${new URL("/rappels", msg.url).toString()})`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f2a22">
<p style="margin:0 0 4px;font-size:17px;font-weight:bold">${esc(msg.title)}</p>
${lines.map((l) => `<p style="margin:0">${esc(l)}</p>`).join("\n")}
<p style="margin:16px 0"><a href="${esc(msg.url)}" style="background:#2f5d3a;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir la tâche</a></p>
<p style="margin:0;font-size:13px;color:#6b756d">Carnet · <a href="${esc(new URL("/rappels", msg.url).toString())}" style="color:#6b756d">réglages des rappels</a></p>
</div>`,
  });
}

// ---------- Notifications (Web Push) ----------
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let vapidSet = false;
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, msg: ReminderMessage): Promise<"ok" | "gone"> {
  if (!vapidSet) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || `mailto:${process.env.ADMIN_EMAILS?.split(",")[0]?.trim() || "admin@example.com"}`,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    vapidSet = true;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(msg),
      { TTL: 6 * 3600, urgency: "high", topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) },
    );
    return "ok";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    throw err;
  }
}

/** Canaux réellement disponibles selon la configuration. */
export function configuredSenders(): Senders {
  return {
    ...(emailConfigured() ? { email: sendEmail } : {}),
    ...(pushConfigured() ? { push: sendPush } : {}),
  };
}
