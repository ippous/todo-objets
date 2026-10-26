import { expect, test, type Page } from "@playwright/test";

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
}

test("une adresse non autorisée est refusée", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill("inconnu@example.com");
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByText("Adresse non autorisée ou code incorrect")).toBeVisible();
});

test("parcours complet : objets, tâches, cumuls, déplacement, récurrence", async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now().toString(36)}`;
  const root = `Tracteur ${suffix}`;
  const child = `Moteur ${suffix}`;
  await login(page);

  // Nouvelle racine (les objets ne font pas forcément partie d'une propriété)
  await page.getByRole("link", { name: "Nouvel objet racine" }).click();
  await page.getByLabel("Nom").fill(root);
  await page.getByLabel(/^Type/).fill("véhicule");
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: root })).toBeVisible();

  // Sous-objet
  await page.getByRole("link", { name: "Ajouter un sous-objet" }).click();
  await page.getByLabel("Nom").fill(child);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: child })).toBeVisible();

  // Tâche récurrente sur le sous-objet
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre").fill(`Vidange ${suffix}`);
  await page.getByLabel("Durée (heures)").first().fill("2,5");
  await page.getByLabel("Valeur (€)").first().fill("150");
  await expect(page.getByText("Soit 60 €/h")).toBeVisible();
  await page.getByLabel("Échéance").fill("2026-11-15");
  await page.getByLabel("Récurrence").selectOption("annuelle");
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: child })).toBeVisible();
  await expect(page.getByRole("link", { name: `Vidange ${suffix}` })).toBeVisible();

  // La tâche du descendant remonte sur la racine, avec les cumuls
  await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: root }).click();
  await expect(page.getByRole("link", { name: `Vidange ${suffix}` })).toBeVisible();
  const bilan = page.getByRole("region", { name: "Bilan" });
  await expect(bilan).toContainText("2,5 h");
  await expect(bilan).toContainText("150 €");

  // Déplacement interdit sous son propre descendant : l'option n'est pas proposée
  await page.getByRole("link", { name: "Modifier ou déplacer" }).click();
  const parentSelect = page.getByLabel("Nouveau parent");
  await expect(parentSelect.locator("option", { hasText: child })).toHaveCount(0);
  // Déplacement sous la propriété existante
  await parentSelect.selectOption({ label: "Le Moulin FRat" });
  await page.getByRole("button", { name: "Déplacer" }).click();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText("Le Moulin FRat");

  // Terminer la tâche depuis la liste à plat : saisie du réalisé + occurrence suivante
  await page.goto(`/taches?q=${encodeURIComponent(suffix)}`);
  const row = page.getByRole("listitem").filter({ hasText: `Vidange ${suffix}` });
  await expect(row).toHaveCount(1);
  await row.getByText("Terminer").click();
  await row.getByLabel("Heures").fill("3");
  await row.getByRole("button", { name: "Marquer comme fait" }).click();
  // L'occurrence suivante (échéance 2027) apparaît dans les tâches ouvertes
  await expect(page.getByRole("listitem").filter({ hasText: `Vidange ${suffix}` }).filter({ hasText: "2027" })).toHaveCount(1);

  await page.goto(`/taches?q=${encodeURIComponent(suffix)}&statut=fait`);
  const done = page.getByRole("listitem").filter({ hasText: `Vidange ${suffix}` });
  await expect(done).toContainText("3 h");

  // Arbre : la nouvelle branche est visible sous le Moulin
  await page.goto("/");
  await expect(page.getByRole("link", { name: root })).toBeVisible();
});
