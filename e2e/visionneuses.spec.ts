import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";
const fixture = (f: string) => path.join(__dirname, "fixtures", f);

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

async function upload(page: Page, file: string, type: string) {
  await page.getByLabel("Type des documents à ajouter").selectOption({ label: type });
  await page.getByLabel("Ajouter des documents").setInputFiles(fixture(file));
  await expect(page.getByRole("link", { name: file })).toBeVisible({ timeout: 30_000 });
}

async function open(page: Page, objectUrl: string, file: string) {
  await page.goto(objectUrl);
  await page.getByRole("link", { name: file }).click();
  await expect(page.getByRole("heading", { level: 1, name: file })).toBeVisible();
  await expect(page.getByRole("link", { name: "Télécharger" })).toHaveAttribute("href", /\?telecharger=1$/);
}

test("visionneuses : PDF, Word, Excel, OpenDocument, PowerPoint, CSV, texte, ZIP", async ({ page }, info) => {
  test.setTimeout(120_000);
  const m = testMarker(info);
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(`Chaudière ${m}`);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Chaudière ${m}` })).toBeVisible();
  await page.waitForLoadState("load");
  const objectUrl = page.url();

  const files: [string, string][] = [
    ["notice.pdf", "Mode d'emploi"],
    ["notice.docx", "Mode d'emploi"],
    ["notice.odt", "Guide de démarrage"],
    ["entretien.xlsx", "Facture"],
    ["entretien.ods", "Facture"],
    ["arrosage.pptx", "Plan"],
    ["releves.csv", "Autre"],
    ["journal.txt", "Autre"],
    ["archive.zip", "Autre"],
  ];
  for (const [f, t] of files) await upload(page, f, t);
  // Regroupés par type
  await expect(page.getByRole("heading", { level: 3, name: "Mode d'emploi" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Guide de démarrage" })).toBeVisible();

  await open(page, objectUrl, "notice.pdf");
  await expect(page.getByText("1 page", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "Page 1 sur 1" })).toBeVisible();

  await open(page, objectUrl, "notice.docx");
  await expect(page.locator("article.doc-preview").getByText("Notice de la chaudière")).toBeVisible();
  await expect(page.locator("article.doc-preview").getByText("Pression nominale 1,5 bar")).toBeVisible();

  await open(page, objectUrl, "notice.odt");
  await expect(page.locator("article.doc-preview").getByText("Purger le circuit chaque automne.")).toBeVisible();

  await open(page, objectUrl, "entretien.xlsx");
  await expect(page.getByRole("columnheader", { name: "Pièce" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "42,5" })).toBeVisible();
  await page.getByRole("tab", { name: "Fournisseurs" }).click();
  await expect(page.getByRole("cell", { name: "Agri Pièces" })).toBeVisible();

  await open(page, objectUrl, "entretien.ods");
  await expect(page.getByRole("columnheader", { name: "Pièce" })).toBeVisible();
  await page.getByRole("tab", { name: "Fournisseurs" }).click();
  await expect(page.getByRole("cell", { name: "Agri Pièces" })).toBeVisible();

  await open(page, objectUrl, "arrosage.pptx");
  await expect(page.getByText("Plan d'arrosage")).toBeVisible();
  await expect(page.getByText("Pompe nord : 6 h")).toBeVisible();

  await open(page, objectUrl, "releves.csv");
  await expect(page.getByRole("columnheader", { name: "Compteur" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 610" })).toBeVisible();

  await open(page, objectUrl, "journal.txt");
  await expect(page.getByText("Ligne 1 — démarrage")).toBeVisible();

  await open(page, objectUrl, "archive.zip");
  await expect(page.getByText("2 fichiers dans l'archive")).toBeVisible();
  await expect(page.getByText("factures/f1.txt")).toBeVisible();

  // Le fil d'Ariane ramène à l'objet
  await page.getByRole("navigation", { name: "Fil d'Ariane" }).getByRole("link", { name: `Chaudière ${m}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Chaudière ${m}` })).toBeVisible();
});

test("la visionneuse n'est pas accessible sans connexion", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await page.goto("/documents/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/connexion/);
  await ctx.close();
});
