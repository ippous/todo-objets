import { expect, test, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "ippous@gmail.com";
const SECRET = process.env.E2E_SECRET ?? "test-local";

test.beforeEach(async ({ page }) => {
  const share = process.env.E2E_VERCEL_SHARE;
  if (share) await page.goto(`/?_vercel_share=${encodeURIComponent(share)}`);
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail autorisée").fill(EMAIL);
  await page.getByLabel("Code de test").fill(SECRET);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arbre des objets" })).toBeVisible();
});

async function createRoot(page: Page, name: string) {
  await page.goto("/objets/nouveau");
  await page.getByLabel("Nom").fill(name);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/objets/")[1];
}

async function createChild(page: Page, parentId: string, name: string) {
  await page.goto(`/objets/nouveau?parent=${parentId}`);
  await page.getByLabel("Nom").fill(name);
  await page.getByRole("button", { name: "Créer l'objet" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/objets/")[1];
}

/** Génère une vraie image JPEG dans le navigateur. */
async function jpeg(page: Page, color: string, w = 1200, h = 900): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([c, width, height]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width as number;
      canvas.height = height as number;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = c as string;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(40, 40, 200, 120);
      return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
    },
    [color, w, h],
  );
  return Buffer.from(b64, "base64");
}

const row = (page: Page, name: string) =>
  page.locator(".tree li > div").filter({ has: page.getByRole("link", { name, exact: true }) });

test("déplacer avec le mode « Déplacer », puis supprimer depuis l'arbre", async ({ page }, info) => {
  const s = `${info.project.name}-${Date.now().toString(36)}`;
  const a = `Grange ${s}`;
  const b = `Hangar ${s}`;
  const c = `Établi ${s}`;
  await createRoot(page, a);
  const bId = await createRoot(page, b);
  await createChild(page, bId, c);
  await page.goto("/");

  // L'objet ne peut pas être placé sous son propre descendant
  await row(page, b).getByRole("button", { name: `Actions pour ${b}` }).click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  await expect(page.getByText(`Où placer « ${b} » ?`)).toBeVisible();
  await expect(row(page, c).getByRole("button", { name: "Placer ici" })).toHaveCount(0);
  await row(page, a).getByRole("button", { name: "Placer ici" }).click();
  await expect(page.getByText(`« ${b} » est maintenant sous « ${a} ».`)).toBeVisible();

  // Le déplacement est visible sur la fiche
  await row(page, c).getByRole("link", { name: c }).click();
  await expect(page.getByRole("navigation", { name: "Fil d'Ariane" })).toContainText(`${a}›${b}›${c}`.replace(/›/g, "›"));
  await page.goto("/");

  // Suppression refusée tant qu'il y a des sous-objets
  await row(page, a).getByRole("button", { name: `Actions pour ${a}` }).click();
  await expect(page.getByText("Suppression impossible : contient des sous-objets.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Suppression avec confirmation d'une feuille
  await row(page, c).getByRole("button", { name: `Actions pour ${c}` }).click();
  await page.getByRole("menuitem", { name: "Supprimer…" }).click();
  await expect(page.getByText(`Supprimer définitivement « ${c} » ?`)).toBeVisible();
  await page.getByRole("button", { name: "Non" }).click();
  await page.getByRole("menuitem", { name: "Supprimer…" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByText(`« ${c} » a été supprimé.`)).toBeVisible();
  await expect(page.getByRole("link", { name: c, exact: true })).toHaveCount(0);

  // Remise en racine
  await row(page, b).getByRole("button", { name: `Actions pour ${b}` }).click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  await page.getByRole("button", { name: "En faire une racine" }).click();
  await expect(page.getByText(`« ${b} » est maintenant une racine.`)).toBeVisible();
});

test("glisser-déposer dans l'arbre", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Le glisser-déposer concerne la souris");
  const s = `${info.project.name}-${Date.now().toString(36)}`;
  const a = `Cave ${s}`;
  const b = `Tonneau ${s}`;
  await createRoot(page, a);
  await createRoot(page, b);
  await page.goto("/");
  // Le glisser démarre sur place avant le défilement vers la cible
  const src = row(page, b);
  await src.scrollIntoViewIfNeeded();
  const box = (await src.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + box.height / 2 + 5, { steps: 3 });
  await row(page, a).hover();
  await page.mouse.up();
  await expect(page.getByText(`« ${b} » est maintenant sous « ${a} ».`)).toBeVisible();
});

test("photos : ajout, vignette dans l'arbre, changement de vignette, suppression", async ({ page }, info) => {
  const s = `${info.project.name}-${Date.now().toString(36)}`;
  const name = `Puits ${s}`;
  const id = await createRoot(page, name);

  const red = await jpeg(page, "#b03020");
  const blue = await jpeg(page, "#2040a0", 900, 1400);
  await page.locator('input[type="file"]').setInputFiles([
    { name: "rouge.jpg", mimeType: "image/jpeg", buffer: red },
    { name: "bleu.jpg", mimeType: "image/jpeg", buffer: blue },
  ]);
  await expect(page.getByText("2 photos ajoutées")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Photos \(2\)/ })).toBeVisible();
  await expect(page.getByText("Vignette", { exact: true })).toHaveCount(1);

  // Les images sont servies (et seulement aux personnes connectées)
  const thumbs = page.locator('ul img[src^="/api/photos/"]');
  await expect(thumbs).toHaveCount(2);
  const src = await thumbs.first().getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");

  // Vignette dans l'arbre
  await page.goto("/");
  await expect(row(page, name).locator('img[src^="/api/photos/"]')).toHaveCount(1);

  // Changer de vignette
  await page.goto(`/objets/${id}`);
  await page.getByRole("button", { name: "Agrandir la photo", exact: true }).click();
  await page.getByRole("button", { name: "Utiliser comme vignette" }).click();
  await expect(page.getByText("Cette photo est la vignette")).toBeVisible();
  await page.getByRole("button", { name: "Fermer" }).click();

  // Supprimer la vignette : l'autre photo prend le relais
  await page.getByRole("button", { name: "Agrandir la photo (vignette)" }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByRole("heading", { name: /Photos \(1\)/ })).toBeVisible();
  await expect(page.getByText("Vignette", { exact: true })).toHaveCount(1);

  // Un objet avec photo mais sans tâche ni sous-objet peut être supprimé
  await page.goto("/");
  await row(page, name).getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("menuitem", { name: "Supprimer…" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByText(`« ${name} » a été supprimé.`)).toBeVisible();
  expect((await page.request.get(src!)).status()).toBe(404);
});

test("photos d'une tâche et vignette dans la liste", async ({ page }, info) => {
  const s = `${info.project.name}-${Date.now().toString(36)}`;
  const obj = `Portail ${s}`;
  const id = await createRoot(page, obj);
  await page.goto(`/taches/nouvelle?objet=${id}`);
  await page.getByLabel("Titre").fill(`Huiler ${s}`);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: `Huiler ${s}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Huiler ${s}` })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "gond.jpg",
    mimeType: "image/jpeg",
    buffer: await jpeg(page, "#507040"),
  });
  await expect(page.getByText("Photo ajoutée")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/taches?q=${encodeURIComponent(s)}`);
  await expect(
    page.getByRole("listitem").filter({ hasText: `Huiler ${s}` }).locator('img[src^="/api/photos/"]'),
  ).toHaveCount(1);
});

test("les photos ne sont pas accessibles sans connexion", async ({ browser }) => {
  const ctx = await browser.newContext();
  const res = await ctx.request.get("/api/photos/00000000-0000-0000-0000-000000000000?v=1");
  expect(res.status()).toBe(401);
  await ctx.close();
});
