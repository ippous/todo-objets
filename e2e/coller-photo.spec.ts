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

async function newObject(page: Page, name: string) {
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(name);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.waitForLoadState("load");
}

/** Simule Ctrl+V d'une image PNG (comme une capture d'écran) sur l'élément donné. */
async function pasteImage(page: Page, selector: string, color: string) {
  await page.evaluate(
    async ({ selector, color }) => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 200;
      const g = c.getContext("2d")!;
      g.fillStyle = color;
      g.fillRect(0, 0, 320, 200);
      const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "image.png", { type: "image/png" }));
      const target = document.querySelector(selector) ?? document.body;
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { selector, color },
  );
}

test("coller une image (Ctrl+V) ajoute une photo, sauf dans un champ de saisie", async ({ page }, info) => {
  const m = testMarker(info);
  await newObject(page, `Grange ${m}`);

  await pasteImage(page, "main", "#b03020");
  await expect(page.getByText("Photo ajoutée")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
  await expect(page.getByText("Vignette", { exact: true })).toHaveCount(1);

  // Un collage dans un champ de saisie reste un collage normal : pas de photo
  await page.goto(`${page.url()}/modifier`);
  await pasteImage(page, 'input[name="name"]', "#2040a0");
  await page.waitForTimeout(500);
  await page.goBack();
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();

  // Sur une tâche aussi
  await page.getByRole("link", { name: "Ajouter une tâche", exact: true }).click();
  await page.getByLabel("Titre", { exact: true }).fill(`Tâche ${m}`);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: `Tâche ${m}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Tâche ${m}` })).toBeVisible();
  await page.waitForLoadState("load");
  await pasteImage(page, "h1", "#20a040");
  await expect(page.getByText("Photo ajoutée")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
});

test("bouton « Coller une image » (presse-papiers)", async ({ page, context, browserName }, info) => {
  test.skip(browserName !== "chromium", "API presse-papiers testée sous Chromium");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const m = testMarker(info);
  await newObject(page, `Hangar ${m}`);

  // Presse-papiers sans image : message clair
  await page.evaluate(() => navigator.clipboard.writeText("du texte"));
  await page.getByRole("button", { name: "Coller une image" }).click();
  await expect(page.getByText("Le presse-papiers ne contient pas d'image")).toBeVisible();

  // Image dans le presse-papiers
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 200;
    c.getContext("2d")!.fillRect(0, 0, 200, 200);
    const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await page.getByRole("button", { name: "Coller une image" }).click();
  await expect(page.getByText("Photo ajoutée")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
});
