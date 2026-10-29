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

test("journal : les actions faites dans l'interface apparaissent sur la fiche et dans le journal", async ({ page }, info) => {
  const suffix = testMarker(info);
  const objet = `Cellier ${suffix}`;
  const tache = `Trier ${suffix}`;
  await login(page);

  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objet);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(tache);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: tache }).click();
  await expect(page.getByRole("heading", { level: 1, name: tache })).toBeVisible();

  // Modification de la priorité depuis la fiche
  await page.getByLabel("Priorité").selectOption("haute");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objet })).toBeVisible();

  // Historique de l'objet : création de l'objet et de la tâche, modification de la tâche
  await page.getByText("Historique de l'objet et de ses tâches").click();
  const history = page.locator("details", { hasText: "Historique de l'objet" });
  await expect(history.getByText("Priorité : Moyenne → Haute")).toBeVisible();
  await expect(history.getByRole("link", { name: tache }).first()).toBeVisible();
  await expect(history.getByText("Interface").first()).toBeVisible();

  // Journal global, filtré sur l'origine
  await page.goto("/journal?origine=interface");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByText(objet).first()).toBeVisible();
  await page.goto("/journal?origine=mcp");
  await expect(page.getByText(objet)).toHaveCount(0);
});
