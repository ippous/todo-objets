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
  await purge(page, testMarker(info)); // restes d'un essai précédent
});

// Chaque test efface ce qu'il a créé, même s'il échoue.
test.afterEach(async ({ page }, info) => {
  await purge(page, testMarker(info));
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
  const s = testMarker(info);
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
  const s = testMarker(info);
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
  const s = testMarker(info);
  const name = `Puits ${s}`;
  const id = await createRoot(page, name);

  const red = await jpeg(page, "#b03020");
  const blue = await jpeg(page, "#2040a0", 900, 1400);
  await page.getByLabel("Ajouter des photos").setInputFiles([
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
  const s = testMarker(info);
  const obj = `Portail ${s}`;
  const id = await createRoot(page, obj);
  await page.goto(`/taches/nouvelle?objet=${id}`);
  await page.getByLabel("Titre", { exact: true }).fill(`Huiler ${s}`);
  await page.getByRole("button", { name: "Créer la tâche" }).click();
  await page.getByRole("link", { name: `Huiler ${s}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Huiler ${s}` })).toBeVisible();
  await page.getByLabel("Ajouter des photos").setInputFiles({
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
  const share = process.env.E2E_VERCEL_SHARE;
  // Sur un déploiement protégé, on passe la protection Vercel sans ouvrir de session Carnet
  if (share) await ctx.request.get(`/?_vercel_share=${encodeURIComponent(share)}`);
  const res = await ctx.request.get("/api/photos/00000000-0000-0000-0000-000000000000?v=1");
  expect(res.status()).toBe(401);
  await ctx.close();
});

test("ajout en lot d'objets et de tâches", async ({ page }, info) => {
  const s = testMarker(info);
  const parent = `Verger ${s}`;
  const id = await createRoot(page, parent);

  // Plusieurs sous-objets : saisie ligne à ligne avec Entrée, puis collage d'une liste
  await page.getByRole("button", { name: "Plusieurs sous-objets" }).click();
  const dialog = page.getByRole("dialog", { name: `Ajouter des sous-objets à « ${parent} »` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nom 1").fill(`Pommier ${s}`);
  await dialog.getByLabel("Nom 1").press("Enter");
  await expect(dialog.getByLabel("Nom 2")).toBeFocused();
  await dialog.getByLabel("Nom 2").fill(`Poirier ${s}`);
  await dialog.getByLabel("Nom 2").press("Enter");
  await page.evaluate((text) => {
    const input = document.activeElement as HTMLInputElement;
    const data = new DataTransfer();
    data.setData("text", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, `- Cerisier ${s}\n- Prunier ${s}\n\n`);
  await expect(dialog.getByLabel("Nom 4")).toHaveValue(`Prunier ${s}`);
  await dialog.getByLabel("Type").selectOption({ label: "équipement" });
  await dialog.getByRole("button", { name: "Créer 4 objets" }).click();
  await expect(page.getByText(`4 objets créés sous « ${parent} ».`)).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.reload();
  for (const n of ["Pommier", "Poirier", "Cerisier", "Prunier"]) {
    await expect(page.getByRole("link", { name: `${n} ${s}` })).toBeVisible();
  }

  // Plusieurs tâches avec réglages communs, depuis le menu de l'arbre
  await page.goto("/");
  await row(page, `Pommier ${s}`).getByRole("button", { name: `Actions pour Pommier ${s}` }).click();
  await page.getByRole("menuitem", { name: "Ajouter plusieurs tâches…" }).click();
  const d2 = page.getByRole("dialog", { name: `Ajouter des tâches à « Pommier ${s} »` });
  await d2.getByLabel("Titre 1").fill(`Tailler ${s}`);
  await d2.getByLabel("Titre 1").press("Enter");
  await d2.getByLabel("Titre 2").fill(`Traiter ${s}`);
  await d2.getByLabel("Titre 2").press("Enter");
  await d2.getByLabel("Titre 3").fill("à retirer");
  await d2.getByRole("button", { name: "Retirer la ligne 3" }).click();
  await d2.getByLabel("Catégorie").selectOption("travaux");
  await d2.getByLabel("Priorité").selectOption("haute");
  await d2.getByRole("button", { name: "Créer 2 tâches" }).click();
  await expect(page.getByText(`2 tâches créées sur « Pommier ${s} ».`)).toBeVisible();

  // Les tâches remontent sur le parent, avec la priorité commune
  await page.goto(`/objets/${id}`);
  for (const t of [`Tailler ${s}`, `Traiter ${s}`]) {
    const r = page.getByRole("listitem").filter({ hasText: t });
    await expect(r).toContainText("Priorité haute");
    await expect(r).toContainText("Travaux");
  }
});

test("documents et liens d'un objet", async ({ page }, info) => {
  const s = testMarker(info);
  const name = `Chaudière ${s}`;
  const id = await createRoot(page, name);
  // Pas de « networkidle » : les aperçus Vercel gardent des connexions ouvertes
  await page.waitForLoadState("load");

  // Document PDF
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  );
  await page.getByLabel("Ajouter des documents").setInputFiles({
    name: "Notice chaudière été.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.getByText("Document ajouté")).toBeVisible({ timeout: 30_000 });
  const docLink = page.getByRole("link", { name: "Notice chaudière été.pdf" });
  await expect(docLink).toBeVisible();
  const viewer = await docLink.getAttribute("href");
  expect(viewer).toMatch(/^\/documents\/[0-9a-f-]{36}$/);
  const href = `/api${viewer}`;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-disposition"]).toContain("inline");
  expect((await page.request.get(`${href}?telecharger=1`)).headers()["content-disposition"]).toContain("attachment");

  // Type refusé
  await page.getByLabel("Ajouter des documents").setInputFiles({
    name: "script.html",
    mimeType: "text/html",
    buffer: Buffer.from("<script>alert(1)</script>"),
  });
  await expect(page.getByText("ce type de fichier n'est pas accepté")).toBeVisible();

  // Liens
  await page.getByLabel("Adresse du lien").fill("fabricant-chaudieres.fr/modele-z");
  await page.getByLabel("Titre (facultatif)").fill("Fiche du modèle");
  await page.getByRole("button", { name: "Ajouter le lien" }).click();
  const link = page.getByRole("link", { name: "Fiche du modèle" });
  await expect(link).toHaveAttribute("href", "https://fabricant-chaudieres.fr/modele-z");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Adresse du lien")).toHaveValue("");

  await page.getByLabel("Adresse du lien").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Ajouter le lien" }).click();
  await expect(page.getByText("Seules les adresses web (http, https) sont acceptées")).toBeVisible();

  // Suppressions avec confirmation
  await page.getByRole("button", { name: "Supprimer le lien Fiche du modèle" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByRole("link", { name: "Fiche du modèle" })).toHaveCount(0);
  await page.getByRole("button", { name: "Supprimer Notice chaudière été.pdf" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByRole("link", { name: "Notice chaudière été.pdf" })).toHaveCount(0);
  expect((await page.request.get(href)).status()).toBe(404);

  // Un document n'empêche pas la suppression de l'objet, et part avec lui
  await page.getByLabel("Ajouter des documents").setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("link", { name: "plan.pdf" })).toBeVisible({ timeout: 30_000 });
  const planHref = `/api${await page.getByRole("link", { name: "plan.pdf" }).getAttribute("href")}`;
  await page.goto("/");
  await row(page, name).getByRole("button", { name: `Actions pour ${name}` }).click();
  await page.getByRole("menuitem", { name: "Supprimer…" }).click();
  await page.getByRole("button", { name: "Oui, supprimer" }).click();
  await expect(page.getByText(`« ${name} » a été supprimé.`)).toBeVisible();
  expect((await page.request.get(planHref)).status()).toBe(404);
  void id;
});
