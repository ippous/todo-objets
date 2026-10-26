import { expect, test } from "@playwright/test";
import { purge, testMarker } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

// Caméra simulée par Chromium (mire animée), autorisation accordée d'office
test.use({
  permissions: ["camera"],
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      ...(process.env.CHROMIUM_PATH ? ["--no-sandbox", "--disable-gpu"] : []),
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

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

test("prendre des photos avec la caméra", async ({ page }, info) => {
  const m = testMarker(info);
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(`Serre ${m}`);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Serre ${m}` })).toBeVisible();
  await page.waitForLoadState("load");

  if (info.project.name === "mobile") {
    // Écran tactile : l'appareil photo du téléphone s'ouvre directement
    const native = page.getByLabel("Prendre une photo");
    await expect(native).toHaveAttribute("capture", "environment");
    await expect(native).toHaveAttribute("type", "file");
    return;
  }

  // PC : webcam dans une boîte de dialogue
  await page.getByRole("button", { name: "Prendre une photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Prendre des photos" });
  await expect(dialog).toBeVisible();
  const shutter = dialog.getByRole("button", { name: "Déclencher" });
  await expect(shutter).toBeEnabled({ timeout: 15_000 });
  await shutter.click();
  await expect(dialog.getByText("1 photo prise")).toBeVisible();
  await shutter.click();
  await expect(dialog.getByText("2 photos prises")).toBeVisible();
  // On en retire une
  await dialog.getByRole("button", { name: "Retirer la photo 2" }).click();
  await expect(dialog.getByText("1 photo prise")).toBeVisible();
  await dialog.getByRole("button", { name: "Ajouter la photo" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Photo ajoutée")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
  await expect(page.getByText("Vignette", { exact: true })).toHaveCount(1);

  // Annuler ne garde rien
  await page.getByRole("button", { name: "Prendre une photo" }).click();
  await expect(dialog.getByRole("button", { name: "Déclencher" })).toBeEnabled({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Déclencher" }).click();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
});
