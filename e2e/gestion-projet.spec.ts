import { expect, test, type Page } from "@playwright/test";
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

async function newTask(page: Page, objetId: string, title: string, start: string, due: string, waitFor?: string) {
  await page.goto(`/taches/nouvelle?objet=${objetId}`);
  await page.getByLabel("Titre", { exact: true }).fill(title);
  await page.getByLabel("Début (facultatif)").fill(start);
  await page.getByLabel("Échéance", { exact: true }).fill(due);
  if (waitFor) {
    await page.getByRole("combobox", { name: "Ajouter une tâche attendue" }).fill(waitFor);
    await page.getByRole("option", { name: new RegExp(waitFor) }).click();
    await expect(page.getByRole("list", { name: "Tâches attendues" })).toContainText(waitFor);
  }
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await expect(page).toHaveURL(new RegExp(`/objets/${objetId}`));
}

test("enchaînement de tâches, Gantt et avancement", async ({ page, isMobile }, info) => {
  const m = testMarker(info);
  // Projet : un objet racine
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom", { exact: true }).fill(`Grange ${m}`);
  await page.getByRole("button", { name: /Créer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Grange ${m}` })).toBeVisible();
  const objetId = page.url().split("/objets/")[1].split(/[?#]/)[0];

  await newTask(page, objetId, `Démonter ${m}`, "2026-11-05", "2026-11-08");
  await newTask(page, objetId, `Semer ${m}`, "2026-11-06", "2026-11-12", `Démonter ${m}`);

  // Liste : la tâche qui attend est bloquée
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Semer ${m}` }) });
  await expect(row.getByText("Bloquée")).toBeVisible();

  // Fiche : état et enchaînement
  await page.getByRole("link", { name: `Semer ${m}` }).click();
  await expect(page.getByText(`Bloquée : attend « Démonter ${m} »`)).toBeVisible();
  await expect(page.getByLabel("Début (facultatif)")).toHaveValue("2026-11-06");
  await page.goto(`/objets/${objetId}`);
  await page.getByRole("link", { name: `Démonter ${m}` }).click();
  await expect(page.getByText(/Débloque/)).toContainText(`Semer ${m}`);

  // Boucle refusée
  await page.getByRole("combobox", { name: "Ajouter une tâche attendue" }).fill(`Semer ${m}`);
  await page.getByRole("option", { name: new RegExp(`Semer ${m}`) }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Boucle" })).toBeVisible();

  // Avancement sur la fiche de l'objet, puis Gantt
  await page.goto(`/objets/${objetId}`);
  const progress = page.getByRole("region", { name: "Avancement" });
  await expect(progress).toContainText("0 / 2");
  await expect(progress).toContainText("12 nov. 2026");
  await progress.getByRole("link", { name: "Voir le Gantt →" }).click();
  await expect(page).toHaveURL(/vue=gantt/);
  if (isMobile) {
    await expect(page.getByRole("link", { name: `Semer ${m}` }).last()).toBeVisible();
  } else {
    await expect(page.getByRole("link", { name: new RegExp(`^Semer ${m}, `) })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "1 enchaînement en conflit" })).toBeVisible();
    await page.getByRole("button", { name: "Mois" }).click();
    await expect(page.getByRole("button", { name: "Mois" })).toHaveAttribute("aria-pressed", "true");
  }

  // Démonter fait : Semer est prête
  await page.goto(`/objets/${objetId}`);
  const demonter = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Démonter ${m}` }) });
  await demonter.getByText("Terminer").click();
  await demonter.getByRole("button", { name: "Marquer comme fait" }).click();
  await expect(demonter).toHaveCount(0); // les tâches faites sont masquées sur la fiche
  await page.goto(`/taches?q=${encodeURIComponent(`Semer ${m}`)}`);
  await page.getByRole("link", { name: `Semer ${m}` }).click();
  await expect(page.getByText("Prête : les tâches attendues sont faites")).toBeVisible();
});
