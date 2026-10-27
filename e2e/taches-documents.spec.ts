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

test("documents et liens d'une tâche", async ({ page }, info) => {
  const m = testMarker(info);
  const objet = `Chaufferie ${m}`;
  const tache = `Remplacer le brûleur ${m}`;

  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(tache);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();

  // Fiche de la tâche
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();
  await page.waitForLoadState("load");
  const taskUrl = page.url();

  // Document « Devis »
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  await page.getByLabel("Type des documents à ajouter").selectOption({ label: "Devis" });
  await page.getByLabel("Ajouter des documents").setInputFiles({ name: "devis-bruleur.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("link", { name: "devis-bruleur.pdf" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Documents \(1\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Devis" })).toBeVisible();

  // Lien
  await page.getByLabel("Adresse du lien").fill("chauffagiste.fr/rdv");
  await page.getByLabel("Titre (facultatif)").fill("Prendre rendez-vous");
  await page.getByRole("button", { name: "Ajouter le lien" }).click();
  const link = page.getByRole("link", { name: "Prendre rendez-vous" });
  await expect(link).toHaveAttribute("href", "https://chauffagiste.fr/rdv");
  await expect(link).toHaveAttribute("target", "_blank");

  // Visionneuse : le fil d'Ariane mène à la tâche
  await page.getByRole("link", { name: "devis-bruleur.pdf" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "devis-bruleur.pdf" })).toBeVisible();
  const crumbs = page.getByRole("navigation", { name: "Fil d'Ariane" });
  await expect(crumbs.getByRole("link", { name: objet })).toBeVisible();
  const href = `/api${new URL(page.url()).pathname}`;
  expect((await page.request.get(href)).status()).toBe(200);
  await crumbs.getByRole("link", { name: `Tâche : ${tache}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();

  await page.goto(taskUrl);

  // Supprimer la tâche emporte son document (fichier compris) et son lien
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Supprimer la tâche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Documents/ })).toHaveText("Documents");
  expect((await page.request.get(href)).status()).toBe(404);
});
