import { expect, test } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

test.beforeEach(async ({ page }, info) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
  await purge(page, testMarker(info));
});

test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
});

test("descriptions en texte enrichi : objets et tâches", async ({ page }, info) => {
  const m = testMarker(info);
  const name = `Serre ${m}`;

  // Création d'un objet avec une description mise en forme
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(name);
  const editor = page.getByRole("textbox", { name: "Description" });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("Structure ");
  await page.getByRole("button", { name: "Gras (Ctrl+B)" }).click();
  await expect(page.getByRole("button", { name: "Gras (Ctrl+B)" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("acier");
  await page.getByRole("button", { name: "Gras (Ctrl+B)" }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Liste à puces" }).click();
  await page.keyboard.type("Vitres à changer");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Notice");
  // Lien sur le mot « Notice »
  await page.keyboard.down("Shift");
  for (let k = 0; k < 6; k++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Lien", exact: true }).click();
  await page.getByLabel("Adresse du lien").fill("fabricant.fr/serre");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // Affichage sur la fiche
  const desc = page.locator("header .rich");
  await expect(desc.locator("strong")).toHaveText("acier");
  await expect(desc.getByRole("listitem")).toHaveCount(2);
  const link = desc.getByRole("link", { name: "Notice" });
  await expect(link).toHaveAttribute("href", "https://fabricant.fr/serre");
  await expect(link).toHaveAttribute("target", "_blank");

  // Modification : l'éditeur reprend le contenu existant
  await page.getByRole("link", { name: "Modifier ou déplacer" }).click();
  const edit = page.getByRole("textbox", { name: "Description" });
  await expect(edit.locator("strong")).toHaveText("acier");
  await edit.locator("li").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (PDF)");
  await page.getByRole("button", { name: /Enregistrer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  await expect(page.locator("header .rich")).toContainText("Notice (PDF)");

  // Tâche avec description en italique, puis recherche dans le texte (pas dans les balises)
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(`Nettoyer ${m}`);
  const tdesc = page.getByRole("textbox", { name: "Description" });
  await tdesc.click();
  await page.getByRole("button", { name: "Italique (Ctrl+I)" }).click();
  await page.keyboard.type("au vinaigre blanc");
  await page.getByRole("button", { name: /Créer la tâche|Ajouter la tâche|Enregistrer/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.goto(`/taches?q=${encodeURIComponent("vinaigre")}`);
  await expect(page.getByRole("link", { name: `Nettoyer ${m}` })).toBeVisible();
  await page.goto(`/taches?q=${encodeURIComponent(`<em>`)}&statut=toutes`);
  await expect(page.getByRole("link", { name: `Nettoyer ${m}` })).toHaveCount(0);

  await page.goto(`/taches?q=${encodeURIComponent(m)}`);
  await page.getByRole("link", { name: `Nettoyer ${m}` }).click();
  await expect(page.getByRole("textbox", { name: "Description" }).locator("em")).toHaveText("au vinaigre blanc");
});
