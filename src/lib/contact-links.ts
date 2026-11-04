// Commandes intégrées de saisie qui insèrent un lien d'action :
//   $$tel(06 12 34 56 78)        → appeler
//   $$mail(jean@societe.fr)      → écrire un e-mail
//   $$what(06 12 34 56 78)       → ouvrir une discussion WhatsApp
//   $$contact(Jean Dupont; 06…; jean@societe.fr) → fiche contact (.vcf) à ajouter au téléphone
// Logique pure, utilisée par l'éditeur (navigateur) et les tests.

export type ContactLinkKind = "tel" | "mail" | "what" | "contact";

export const CONTACT_COMMANDS: { name: ContactLinkKind; aliases: string[]; usage: string; description: string }[] = [
  { name: "tel", aliases: ["telephone", "appel"], usage: "$$tel(06 12 34 56 78)", description: "Lien pour appeler ce numéro" },
  { name: "mail", aliases: ["email", "courriel"], usage: "$$mail(jean@societe.fr)", description: "Lien pour écrire un e-mail" },
  { name: "what", aliases: ["whatsapp", "wa"], usage: "$$what(06 12 34 56 78)", description: "Lien pour écrire sur WhatsApp" },
  {
    name: "contact",
    aliases: ["vcard"],
    usage: "$$contact(Jean Dupont; 06 12 34 56 78; jean@societe.fr)",
    description: "Fiche contact à ajouter au téléphone",
  },
];

const KIND_BY_NAME = new Map<string, ContactLinkKind>(CONTACT_COMMANDS.flatMap((c) => [c.name, ...c.aliases].map((n) => [n, c.name] as const)));

/** « tel », « whatsapp »… → commande intégrée, ou null. */
export const contactKind = (name: string): ContactLinkKind | null => KIND_BY_NAME.get(name.toLowerCase()) ?? null;

/** Saisie « $$tel(…) » terminée juste avant le curseur. */
export const CONTACT_TRIGGER = /\$\$([a-z]{2,10})\(([^()\n]{1,200})\)$/i;

const EMAIL = /^[^\s@<>"'();,]+@[^\s@<>"'();,]+\.[^\s@<>"'();,]{2,}$/;

/** Chiffres d'un numéro, « + » de tête conservé : « +33 (0)6 12.34 » → « +33612… ». */
export function cleanPhone(raw: string): string | null {
  const s = raw.trim().replace(/\(0\)/g, "");
  if (!/^[+\d][\d\s.\-()/]*$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 15) return null;
  return (s.startsWith("+") ? "+" : "") + digits;
}

/** Numéro international sans « + », comme l'attend wa.me (06… en France → 336…). */
export function internationalPhone(raw: string, defaultCountry = "33"): string | null {
  const p = cleanPhone(raw);
  if (!p) return null;
  if (p.startsWith("+")) return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.startsWith("0") && p.length === 10) return defaultCountry + p.slice(1);
  return p.length >= 8 ? p : null;
}

export type ContactCard = { name: string | null; phones: string[]; emails: string[] };

/** « Jean Dupont; 06 12 34 56 78; jean@x.fr » → nom, téléphones, e-mails (dans n'importe quel ordre). */
export function parseContact(raw: string): ContactCard {
  const card: ContactCard = { name: null, phones: [], emails: [] };
  for (const part of raw.split(/[;|]/).map((p) => p.trim()).filter(Boolean)) {
    if (EMAIL.test(part)) card.emails.push(part);
    else if (cleanPhone(part)) card.phones.push(cleanPhone(part)!);
    else if (!card.name) card.name = part.slice(0, 80);
  }
  return card;
}

export type ContactLink = { href: string; text: string } | { error: string };

/** Lien à insérer pour une commande intégrée et son argument. */
export function buildContactLink(kind: ContactLinkKind, arg: string): ContactLink {
  const value = arg.trim();
  switch (kind) {
    case "tel": {
      const p = cleanPhone(value);
      return p ? { href: `tel:${p}`, text: value } : { error: `« ${value} » n'est pas un numéro de téléphone` };
    }
    case "mail":
      return EMAIL.test(value) ? { href: `mailto:${value}`, text: value } : { error: `« ${value} » n'est pas une adresse e-mail` };
    case "what": {
      const p = internationalPhone(value);
      return p ? { href: `https://wa.me/${p}`, text: `WhatsApp ${value}` } : { error: `« ${value} » n'est pas un numéro WhatsApp` };
    }
    case "contact": {
      const c = parseContact(value);
      if (!c.name && !c.phones.length && !c.emails.length) return { error: "Indique au moins un nom, un numéro ou une adresse" };
      const q = new URLSearchParams();
      if (c.name) q.set("n", c.name);
      for (const p of c.phones) q.append("tel", p);
      for (const e of c.emails) q.append("email", e);
      return { href: `/api/vcard?${q.toString()}`, text: c.name ?? c.phones[0] ?? c.emails[0] };
    }
  }
}

/** Lien d'action à ouvrir d'un simple clic dans l'éditeur (les autres liens restent modifiables). */
export const isActionHref = (href: string) => /^(tel:|mailto:|https:\/\/wa\.me\/|\/api\/vcard\?)/i.test(href);

const vEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);

/** Fiche vCard 3.0 (lue par Android, iOS, Outlook…). */
export function toVCard(c: ContactCard): string {
  const name = c.name ?? c.phones[0] ?? c.emails[0] ?? "Contact";
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const first = parts.length > 1 ? parts[0] : name;
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vEscape(last)};${vEscape(first)};;;`,
    `FN:${vEscape(name)}`,
    ...c.phones.map((p) => `TEL;TYPE=CELL:${p}`),
    ...c.emails.map((e) => `EMAIL;TYPE=INTERNET:${vEscape(e)}`),
    "END:VCARD",
    "",
  ].join("\r\n");
}
