// Fiche contact (.vcf) des liens $$contact(…) : l'ouvrir sur un téléphone propose d'ajouter le contact.
import { cleanPhone, toVCard, type ContactCard } from "@/lib/contact-links";
import { getCurrentUser } from "@/lib/session";

const EMAIL = /^[^\s@<>"'();,]+@[^\s@<>"'();,]+\.[^\s@<>"'();,]{2,}$/;

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return new Response("Non connecté", { status: 401 });
  const q = new URL(request.url).searchParams;
  const card: ContactCard = {
    name: q.get("n")?.trim().slice(0, 80) || null,
    phones: q.getAll("tel").map(cleanPhone).filter((p): p is string => !!p).slice(0, 5),
    emails: q.getAll("email").map((e) => e.trim()).filter((e) => EMAIL.test(e)).slice(0, 5),
  };
  if (!card.name && !card.phones.length && !card.emails.length) return new Response("Contact vide", { status: 400 });
  const file = (card.name ?? "contact").normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "contact";
  return new Response(toVCard(card), {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": `inline; filename="${file}.vcf"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
