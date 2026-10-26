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

test("types d'objets et de documents : ajout, renommage, suppression bloquée si utilisé", async ({ page }, info) => {
  const m = testMarker(info);
  const objSection = () => page.getByRole("region", { name: /Types d'objets/ });
  const docSection = () => page.getByRole("region", { name: /Types de documents/ });

  await page.goto("/types");
  await expect(page.getByRole("heading", { level: 1, name: "Types" })).toBeVisible();
  // Types de départ
  await expect(docSection().getByText("Mode d'emploi", { exact: true })).toBeVisible();
  await expect(docSection().getByText("Guide de démarrage", { exact: true })).toBeVisible();

  // Ajout puis doublon refusé
  await objSection().getByLabel("Nouveau type").fill(`Serre ${m}`);
  await objSection().getByRole("button", { name: "Ajouter" }).click();
  await expect(objSection().getByText(`Serre ${m}`, { exact: true })).toBeVisible();
  await objSection().getByLabel("Nouveau type").fill(`SERRE ${m}`);
  await objSection().getByRole("button", { name: "Ajouter" }).click();
  await expect(objSection().getByRole("alert")).toContainText("existe déjà");

  // Renommage
  await objSection().getByRole("button", { name: `Renommer Serre ${m}` }).click();
  await objSection().getByLabel(`Nouveau nom pour Serre ${m}`).fill(`Serre chauffée ${m}`);
  await objSection().getByRole("button", { name: "Enregistrer" }).click();
  await expect(objSection().getByText(`Serre chauffée ${m}`, { exact: true })).toBeVisible();

  // Un objet l'utilise : suppression impossible
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(`Abri ${m}`);
  await page.getByLabel(/^Type/).selectOption({ label: `Serre chauffée ${m}` });
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Abri ${m}` })).toBeVisible();
  await expect(page.getByText(`Serre chauffée ${m}`).first()).toBeVisible();
  const objectUrl = page.url();

  await page.goto("/types");
  await expect(objSection().getByRole("button", { name: `Supprimer Serre chauffée ${m}` })).toBeDisabled();
  await expect(
    objSection().getByRole("listitem").filter({ hasText: `Serre chauffée ${m}` }).getByText("1 objet", { exact: true }),
  ).toBeVisible();

  // On retire le type de l'objet : la suppression redevient possible
  await page.goto(`${objectUrl}/modifier`);
  await page.getByLabel(/^Type/).selectOption({ label: "Sans type" });
  await page.getByRole("button", { name: /Enregistrer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Abri ${m}` })).toBeVisible();
  await page.goto("/types");
  await objSection().getByRole("button", { name: `Supprimer Serre chauffée ${m}` }).click();
  await objSection().getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(objSection().getByText(`Serre chauffée ${m}`, { exact: true })).toHaveCount(0);

  // Type de document : ajout et suppression
  await docSection().getByLabel("Nouveau type").fill(`Notice ${m}`);
  await docSection().getByRole("button", { name: "Ajouter" }).click();
  await expect(docSection().getByText(`Notice ${m}`, { exact: true })).toBeVisible();
  await docSection().getByRole("button", { name: `Supprimer Notice ${m}` }).click();
  await docSection().getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(docSection().getByText(`Notice ${m}`, { exact: true })).toHaveCount(0);
});
