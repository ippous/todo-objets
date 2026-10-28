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

async function createRootWithTask(page: Page, objectName: string, taskTitle: string) {
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(objectName);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: objectName })).toBeVisible();
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(taskTitle);
  await page.getByLabel("Durée (heures)").first().fill("2");
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page.getByRole("link", { name: taskTitle })).toBeVisible();
}

test("tableau : trois colonnes, regroupement par objet racine, changement de statut", async ({ page }, info) => {
  const suffix = testMarker(info);
  const grange = `Grange ${suffix}`;
  const camion = `Camion ${suffix}`;
  const toit = `Toit ${suffix}`;
  const pneus = `Pneus ${suffix}`;
  await login(page);
  await createRootWithTask(page, grange, toit);
  await createRootWithTask(page, camion, pneus);

  await page.goto(`/taches?q=${encodeURIComponent(suffix)}`);
  await page.getByRole("link", { name: "Tableau" }).click();
  await expect(page).toHaveURL(/vue=tableau/);
  const column = (name: string) => page.getByRole("list", { name, exact: true });
  await expect(column("À faire").getByRole("link", { name: toit })).toBeVisible();
  await expect(column("À faire").getByRole("link", { name: pneus })).toBeVisible();

  // Flèche de la carte (tactile, clavier) : « À faire » → « En cours »
  await page.getByRole("button", { name: `Passer « ${toit} » à « En cours »` }).click();
  await expect(column("En cours").getByRole("link", { name: toit })).toBeVisible();

  // Couloirs par objet racine
  await page.getByRole("link", { name: "Par objet racine" }).click();
  await expect(page).toHaveURL(/groupe=racine/);
  const lane = (name: string) => page.getByRole("region", { name });
  await expect(lane(grange).getByRole("link", { name: toit })).toBeVisible();
  await expect(lane(camion).getByRole("link", { name: pneus })).toBeVisible();

  // Glisser-déposer (souris) vers « Fait », persisté après rechargement
  if (info.project.name === "desktop") {
    await lane(camion)
      .getByTestId("carte")
      .filter({ hasText: pneus })
      .dragTo(lane(camion).getByTestId("colonne-fait"));
  } else {
    await page.getByRole("button", { name: `Passer « ${pneus} » à « En cours »` }).click();
    await page.getByRole("button", { name: `Passer « ${pneus} » à « Fait »` }).click();
  }
  await expect(lane(camion).getByTestId("colonne-fait").getByRole("link", { name: pneus })).toBeVisible();
  await page.reload();
  await expect(lane(camion).getByTestId("colonne-fait").getByRole("link", { name: pneus })).toBeVisible();
  await expect(lane(grange).getByTestId("colonne-en_cours").getByRole("link", { name: toit })).toBeVisible();

  // Passée à « fait » sans saisie : la durée estimée devient la durée réalisée
  await page.goto(`/taches?q=${encodeURIComponent(pneus)}&statut=fait`);
  await expect(page.getByRole("listitem").filter({ hasText: pneus })).toContainText("2 h");
});
