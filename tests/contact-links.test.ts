import { describe, expect, it } from "vitest";
import { buildContactLink, CONTACT_TRIGGER, contactKind, internationalPhone, isActionHref, parseContact, toVCard } from "@/lib/contact-links";
import { sanitizeRichText } from "@/lib/rich-text";

describe("liens d'action $$tel, $$mail, $$what, $$contact", () => {
  it("repère la saisie terminée et les alias", () => {
    const m = CONTACT_TRIGGER.exec("Appeler $$TEL(06 12 34 56 78)");
    expect(m?.[1]).toBe("TEL");
    expect(m?.[2]).toBe("06 12 34 56 78");
    expect(contactKind("TEL")).toBe("tel");
    expect(contactKind("whatsapp")).toBe("what");
    expect(contactKind("email")).toBe("mail");
    expect(contactKind("inconnu")).toBeNull();
    expect(CONTACT_TRIGGER.exec("$$tel(06 12")).toBeNull();
  });

  it("téléphone : lien tel: avec les chiffres, texte tel que saisi", () => {
    expect(buildContactLink("tel", "06.12.34.56.78")).toEqual({ href: "tel:0612345678", text: "06.12.34.56.78" });
    expect(buildContactLink("tel", "+33 (0)6 12 34 56 78")).toEqual({ href: "tel:+33612345678", text: "+33 (0)6 12 34 56 78" });
    expect("error" in buildContactLink("tel", "pas un numéro")).toBe(true);
  });

  it("e-mail : lien mailto:", () => {
    expect(buildContactLink("mail", "jean@societe.com")).toEqual({ href: "mailto:jean@societe.com", text: "jean@societe.com" });
    expect("error" in buildContactLink("mail", "user.society.com")).toBe(true);
  });

  it("WhatsApp : numéro international pour wa.me", () => {
    expect(internationalPhone("06 12 34 56 78")).toBe("33612345678");
    expect(internationalPhone("+32 470 12 34 56")).toBe("32470123456");
    expect(internationalPhone("0032 470 12 34 56")).toBe("32470123456");
    expect(buildContactLink("what", "06 12 34 56 78")).toEqual({ href: "https://wa.me/33612345678", text: "WhatsApp 06 12 34 56 78" });
  });

  it("contact : nom, numéros et adresses dans n'importe quel ordre, fiche vCard", () => {
    const c = parseContact("jean@x.fr; Jean Dupont ; 06 12 34 56 78");
    expect(c).toEqual({ name: "Jean Dupont", phones: ["0612345678"], emails: ["jean@x.fr"] });
    const link = buildContactLink("contact", "Jean Dupont; 06 12 34 56 78; jean@x.fr");
    expect(link).toEqual({ href: "/api/vcard?n=Jean+Dupont&tel=0612345678&email=jean%40x.fr", text: "Jean Dupont" });
    const v = toVCard(c);
    expect(v).toContain("FN:Jean Dupont");
    expect(v).toContain("N:Dupont;Jean;;;");
    expect(v).toContain("TEL;TYPE=CELL:0612345678");
    expect("error" in buildContactLink("contact", " ; ")).toBe(true);
  });

  it("les liens survivent au nettoyage du HTML et s'ouvrent d'un clic", () => {
    const html = [
      '<p><a href="tel:0612345678">06</a> <a href="mailto:a@b.fr">m</a>',
      '<a href="https://wa.me/33612345678">w</a> <a href="/api/vcard?n=Jean&amp;tel=0612345678">c</a></p>',
    ].join(" ");
    const clean = sanitizeRichText(html)!;
    for (const h of ["tel:0612345678", "mailto:a@b.fr", "https://wa.me/33612345678", "/api/vcard?n=Jean&amp;tel=0612345678"]) {
      expect(clean).toContain(`href="${h}"`);
    }
    expect(isActionHref("https://wa.me/33612345678")).toBe(true);
    expect(isActionHref("https://example.com")).toBe(false);
  });
});
