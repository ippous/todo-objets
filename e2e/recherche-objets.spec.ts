import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

// Déploiement protégé par Vercel : un lien de partage pose le cookie d'accès.
test.beforeEach(async ({ page }) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
});

async function login(page: Page) {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
  await purge(page, testMarker(test.info()));
}

test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
});

async function createObject(page: Page, name: string) {
  await page.getByLabel("Nom").fill(name);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("arbre : rechercher un objet et l'ouvrir", async ({ page }, info) => {
  const suffix = testMarker(info);
  const grange = `Grange ${suffix}`;
  const ecurie = `Écurie ${suffix}`;
  await login(page);
  await page.goto("/objets/nouveau");
  await createObject(page, grange);
  await page.getByRole("link", { name: "Ajouter un sous-objet" }).click();
  await createObject(page, ecurie);

  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Rechercher un objet" });
  // Sans accent ni majuscule
  await box.fill(`ecurie ${suffix}`);
  const results = page.getByRole("listbox", { name: "Objets trouvés" });
  const option = results.getByRole("option", { name: new RegExp(ecurie) });
  await expect(option).toBeVisible();
  await expect(option).toContainText(grange); // chemin depuis la racine

  // Clavier : flèche puis Entrée
  await box.press("ArrowDown");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: ecurie })).toBeVisible();

  // Clic sur une suggestion
  await page.goto("/");
  await box.fill(`grange ${suffix}`);
  await results.getByRole("option", { name: new RegExp(grange) }).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: grange })).toBeVisible();

  // Rien trouvé
  await page.goto("/");
  await box.fill(`introuvable ${suffix}`);
  await expect(page.getByText(`Aucun objet ne correspond à « introuvable ${suffix} ».`)).toBeVisible();
});
