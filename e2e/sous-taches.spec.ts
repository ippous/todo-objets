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

test("sous-tâches : ajout, case à cocher, ordre par flèches et glisser-déposer, modification, suppression", async ({ page }, info) => {
  const suffix = testMarker(info);
  const objet = `Portail ${suffix}`;
  const tache = `Repeindre ${suffix}`;
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

  const items = page.getByTestId("sous-tache");
  const order = () => items.allInnerTexts().then((t) => t.map((s) => s.split("\n").find((l) => /^[A-Z]/.test(l.trim()))?.trim()));
  const add = async (title: string) => {
    await page.getByLabel("Nouvelle sous-tâche").fill(title);
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(items.filter({ hasText: title })).toBeVisible();
    await expect(page.getByLabel("Nouvelle sous-tâche")).toHaveValue("");
  };
  await add("Poncer");
  await add("Sous-couche");
  // Entrée valide aussi
  await page.getByLabel("Nouvelle sous-tâche").fill("Finition");
  await page.getByLabel("Nouvelle sous-tâche").press("Enter");
  await expect(items).toHaveCount(3);
  expect(await order()).toEqual(["Poncer", "Sous-couche", "Finition"]);

  // Case à cocher, persistée
  await page.getByRole("checkbox", { name: "Poncer" }).check();
  await expect(page.getByTestId("sous-taches-compte")).toHaveText("1 sur 3 faite");

  // Flèches (tactile, clavier)
  await page.getByRole("button", { name: "Descendre « Poncer »" }).click();
  await expect.poll(order).toEqual(["Sous-couche", "Poncer", "Finition"]);
  await expect(page.getByRole("button", { name: "Monter « Sous-couche »" })).toBeDisabled();

  // Glisser-déposer (souris) : « Finition » en tête
  if (info.project.name === "desktop") {
    // Déposée dans la moitié haute de la première ligne : avant elle
    await items.filter({ hasText: "Finition" }).dragTo(items.filter({ hasText: "Sous-couche" }), { targetPosition: { x: 20, y: 3 } });
  } else {
    await page.getByRole("button", { name: "Monter « Finition »" }).click();
    await expect.poll(order).toEqual(["Sous-couche", "Finition", "Poncer"]);
    await page.getByRole("button", { name: "Monter « Finition »" }).click();
  }
  await expect.poll(order).toEqual(["Finition", "Sous-couche", "Poncer"]);

  // Modification du texte
  await page.getByRole("button", { name: "Modifier « Sous-couche »" }).click();
  await page.getByLabel("Texte de la sous-tâche").fill("Sous-couche antirouille");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await expect(items.filter({ hasText: "Sous-couche antirouille" })).toBeVisible();

  // Tout est conservé après rechargement
  await page.reload();
  await expect.poll(order).toEqual(["Finition", "Sous-couche antirouille", "Poncer"]);
  await expect(page.getByRole("checkbox", { name: "Poncer" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Finition" })).not.toBeChecked();

  // Suppression
  await page.getByRole("button", { name: "Supprimer « Finition »" }).click();
  await expect(items).toHaveCount(2);
  await page.reload();
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId("sous-taches-compte")).toHaveText("1 sur 2 faite");
});
